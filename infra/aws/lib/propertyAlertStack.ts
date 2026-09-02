import path from "node:path";

import {
  ArnFormat,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
  TimeZone,
} from "aws-cdk-lib";
import { Port, Vpc, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargatePlatformVersion,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Secret as EcsSecret,
  UlimitName,
} from "aws-cdk-lib/aws-ecs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Rule } from "aws-cdk-lib/aws-events";
import { SnsTopic } from "aws-cdk-lib/aws-events-targets";
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
  ParameterGroup,
} from "aws-cdk-lib/aws-rds";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  Schedule,
  ScheduleExpression,
  TimeWindow,
} from "aws-cdk-lib/aws-scheduler";
import { EcsRunFargateTask } from "aws-cdk-lib/aws-scheduler-targets";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import {
  stageResourceName,
  type DeploymentStage,
} from "./deploymentStage.js";

const databaseName = "property_intelligence";

export interface PropertyAlertStackProps extends StackProps {
  adminContainerImage?: ContainerImage;
  containerImage?: ContainerImage;
  deploymentStage?: DeploymentStage;
  failureAlertEmail?: string;
  priceEstimationRuntimeEnabled?: boolean;
  repositoryRoot?: string;
  scheduleEnabled?: boolean;
  showingListSchedule?: {
    enabled: boolean;
    weekDay: string;
    hour: string;
    minute: string;
    timeZone: string;
  };
}

export class PropertyAlertStack extends Stack {
  readonly applicationSecret: Secret;
  readonly database: DatabaseCluster;
  readonly databaseCredentialsSecret: Secret;
  readonly databaseSecurityGroup: SecurityGroup;
  readonly showingListArtifactBucket: Bucket;
  readonly vpc: Vpc;

  constructor(
    scope: Construct,
    id: string,
    props: PropertyAlertStackProps = {},
  ) {
    super(scope, id, props);

    const deploymentStage = props.deploymentStage ?? "production";
    const isProduction = deploymentStage === "production";
    const priceEstimationRuntimeEnabled =
      props.priceEstimationRuntimeEnabled ?? false;

    this.vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: priceEstimationRuntimeEnabled ? 1 : 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: SubnetType.PUBLIC,
        },
        ...(priceEstimationRuntimeEnabled
          ? [
              {
                cidrMask: 24,
                name: "ApiEgress",
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
              },
            ]
          : []),
        {
          cidrMask: 24,
          name: "Database",
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const workerSecurityGroup = new SecurityGroup(
      this,
      "WorkerSecurityGroup",
      {
        allowAllOutbound: true,
        description: "Outbound-only access for the scheduled property worker",
        vpc: this.vpc,
      },
    );
    this.databaseSecurityGroup = new SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        allowAllOutbound: false,
        description: "Aurora access restricted to the scheduled worker",
        vpc: this.vpc,
      },
    );
    this.databaseSecurityGroup.addIngressRule(
      workerSecurityGroup,
      Port.tcp(5_432),
      "Allow PostgreSQL from the scheduled worker",
    );

    const databaseEngine = DatabaseClusterEngine.auroraPostgres({
      version: AuroraPostgresEngineVersion.VER_16_13,
    });
    const databaseParameterGroup = new ParameterGroup(
      this,
      "DatabaseParameterGroup",
      {
        engine: DatabaseClusterEngine.auroraPostgres({
          version: AuroraPostgresEngineVersion.VER_16_13,
        }),
        parameters: {
          "rds.force_ssl": "1",
        },
      },
    );
    this.databaseCredentialsSecret = new Secret(
      this,
      "DatabaseCredentialsSecret",
      {
        generateSecretString: {
          excludePunctuation: true,
          generateStringKey: "password",
          passwordLength: 30,
          secretStringTemplate: JSON.stringify({
            username: "property_worker",
          }),
        },
        removalPolicy: isProduction
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
        secretName: `cpi/${deploymentStage}/database`,
      },
    );
    this.database = new DatabaseCluster(this, "Database", {
      backup: {
        retention: Duration.days(isProduction ? 7 : 1),
      },
      credentials: Credentials.fromSecret(this.databaseCredentialsSecret),
      defaultDatabaseName: databaseName,
      deletionProtection: isProduction,
      engine: databaseEngine,
      parameterGroup: databaseParameterGroup,
      removalPolicy: isProduction
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      securityGroups: [this.databaseSecurityGroup],
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      serverlessV2MaxCapacity: 1,
      serverlessV2MinCapacity: 0,
      storageEncrypted: true,
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      writer: ClusterInstance.serverlessV2("Writer", {
        autoMinorVersionUpgrade: true,
      }),
    });

    this.applicationSecret = new Secret(this, "ApplicationSecret", {
      description: "Provider credentials and scheduled generation configuration",
      generateSecretString: {
        excludePunctuation: true,
        generateStringKey: "bootstrapNonce",
        secretStringTemplate: JSON.stringify({
          RENTCAST_API_KEY: "",
          TELEGRAM_BOT_TOKEN: "",
          TELEGRAM_CHAT_ID: "",
        }),
      },
      removalPolicy: RemovalPolicy.DESTROY,
      secretName: `cpi/${deploymentStage}/application`,
    });

    this.showingListArtifactBucket = new Bucket(
      this,
      "ShowingListArtifactBucket",
      {
        autoDeleteObjects: true,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        lifecycleRules: [
          {
            abortIncompleteMultipartUploadAfter: Duration.days(1),
            enabled: true,
            id: "AbortIncompleteMultipartUploads",
          },
        ],
        minimumTLSVersion: 1.2,
        objectLockEnabled: false,
        objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
        removalPolicy: RemovalPolicy.DESTROY,
        versioned: false,
      },
    );

    const cluster = new Cluster(this, "Cluster", {
      vpc: this.vpc,
    });
    const containerImage =
      props.containerImage ??
      ContainerImage.fromAsset(
        props.repositoryRoot ?? path.resolve(process.cwd(), "../.."),
        { platform: Platform.LINUX_AMD64 },
      );
    {
      const adminIdPrefix = isProduction ? "Production" : "Dev";
      const adminPhysicalPrefix = isProduction
        ? "cpi-production-admin-bootstrap"
        : "cpi-dev-admin-bootstrap";
      const adminSecretPrefix = `cpi/${deploymentStage}/admin-bootstrap/*`;
      const adminContainerName = `${adminIdPrefix}AdminBootstrap`;
      const adminSecurityGroup = new SecurityGroup(
        this,
        `${adminIdPrefix}AdminBootstrapSecurityGroup`,
        {
          allowAllOutbound: true,
          description: `Outbound-only access for ${deploymentStage} administrator bootstrap`,
          vpc: this.vpc,
        },
      );
      this.databaseSecurityGroup.addIngressRule(
        adminSecurityGroup,
        Port.tcp(5_432),
        `Allow PostgreSQL from the one-time ${deploymentStage} administrator bootstrap`,
      );
      const adminTaskRole = new Role(
        this,
        `${adminIdPrefix}AdminBootstrapTaskRole`,
        {
          assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
          description: `Read one ephemeral credential secret for ${deploymentStage} administrator bootstrap`,
          roleName: `${adminPhysicalPrefix}-task`,
        },
      );
      adminTaskRole.addToPolicy(
        new PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [
            this.formatArn({
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              resource: "secret",
              resourceName: adminSecretPrefix,
              service: "secretsmanager",
            }),
          ],
        }),
      );
      const adminExecutionRole = new Role(
        this,
        `${adminIdPrefix}AdminBootstrapExecutionRole`,
        {
          assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
          description: `Pull the ${deploymentStage} administrator bootstrap image and publish bounded logs`,
          managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName(
              "service-role/AmazonECSTaskExecutionRolePolicy",
            ),
          ],
          roleName: `${adminPhysicalPrefix}-execution`,
        },
      );
      const adminTaskDefinition = new FargateTaskDefinition(
        this,
        `${adminIdPrefix}AdminBootstrapTaskDefinition`,
        {
          cpu: 256,
          executionRole: adminExecutionRole,
          family: adminPhysicalPrefix,
          memoryLimitMiB: 512,
          runtimePlatform: {
            cpuArchitecture: CpuArchitecture.X86_64,
            operatingSystemFamily: OperatingSystemFamily.LINUX,
          },
          taskRole: adminTaskRole,
        },
      );
      const adminLogGroup = new LogGroup(
        this,
        `${adminIdPrefix}AdminBootstrapLogGroup`,
        {
          logGroupName: `/cpi/${deploymentStage}/admin-bootstrap`,
          removalPolicy: isProduction
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY,
          retention: isProduction
            ? RetentionDays.ONE_MONTH
            : RetentionDays.ONE_WEEK,
        },
      );
      const adminContainerImage =
        props.adminContainerImage ??
        ContainerImage.fromAsset(
          props.repositoryRoot ?? path.resolve(process.cwd(), "../.."),
          { file: "Dockerfile.admin", platform: Platform.LINUX_AMD64 },
        );
      adminTaskDefinition.addContainer(adminContainerName, {
        command: [
          "timeout",
          "--signal=TERM",
          "5m",
          "node",
          isProduction
            ? "apps/admin-cli/dist/productionAdminBootstrap.js"
            : "apps/admin-cli/dist/devAdminBootstrap.js",
        ],
        environment: {
          AWS_ACCOUNT_ID: this.account,
          AWS_REGION: this.region,
          CPI_DEPLOYMENT_STAGE: deploymentStage,
          NODE_ENV: "production",
          NODE_EXTRA_CA_CERTS: "/app/certs/global-bundle.pem",
          PGDATABASE: databaseName,
          PGHOST: this.database.clusterEndpoint.hostname,
          PGPORT: this.database.clusterEndpoint.port.toString(),
          PGSSLMODE: "verify-full",
        },
        image: adminContainerImage,
        logging: LogDrivers.awsLogs({
          logGroup: adminLogGroup,
          streamPrefix: "bootstrap",
        }),
        secrets: {
          PGPASSWORD: EcsSecret.fromSecretsManager(
            this.databaseCredentialsSecret,
            "password",
          ),
          PGUSER: EcsSecret.fromSecretsManager(
            this.databaseCredentialsSecret,
            "username",
          ),
        },
      });
      this.databaseCredentialsSecret.grantRead(adminExecutionRole);

      new CfnOutput(this, `${adminIdPrefix}AdminBootstrapClusterArn`, {
        value: cluster.clusterArn,
      });
      new CfnOutput(this, `${adminIdPrefix}AdminBootstrapContainerName`, {
        value: adminContainerName,
      });
      new CfnOutput(this, `${adminIdPrefix}AdminBootstrapSecurityGroupId`, {
        value: adminSecurityGroup.securityGroupId,
      });
      new CfnOutput(this, `${adminIdPrefix}AdminBootstrapSubnetIds`, {
        value: Fn.join(
          ",",
          this.vpc.publicSubnets.map((subnet) => subnet.subnetId),
        ),
      });
      new CfnOutput(
        this,
        `${adminIdPrefix}AdminBootstrapTaskDefinitionArn`,
        {
          value: adminTaskDefinition.taskDefinitionArn,
        },
      );
    }
    const failureAlertEmail =
      props.failureAlertEmail ??
      new CfnParameter(this, "AlertEmail", {
        allowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        constraintDescription: "must be a valid email address",
        type: "String",
      }).valueAsString;
    const failureTopic = new Topic(this, "WorkerFailureTopic", {
      displayName: `CPI ${deploymentStage} worker failures`,
      enforceSSL: true,
      topicName: `cpi-${deploymentStage}-worker-failures`,
    });
    failureTopic.addSubscription(new EmailSubscription(failureAlertEmail));

    const eventPatternBase = {
      detailType: ["ECS Task State Change"],
      source: ["aws.ecs"],
    };
    const taskFailedToStartRule = new Rule(this, "TaskFailedToStartRule", {
      eventPattern: {
        ...eventPatternBase,
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ["STOPPED"],
          stopCode: ["TaskFailedToStart"],
        },
      },
    });
    taskFailedToStartRule.addTarget(new SnsTopic(failureTopic));

    const nonZeroExitRule = new Rule(this, "NonZeroExitRule", {
      eventPattern: {
        ...eventPatternBase,
        detail: {
          clusterArn: [cluster.clusterArn],
          containers: {
            exitCode: [{ "anything-but": 0 }],
          },
          lastStatus: ["STOPPED"],
        },
      },
    });
    nonZeroExitRule.addTarget(new SnsTopic(failureTopic));
    const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new LogGroup(this, "WorkerLogGroup", {
      logGroupName: `/cpi/${deploymentStage}/alert-worker`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_WEEK,
    });
    const container = taskDefinition.addContainer("AlertWorker", {
      command: [
        "timeout",
        "--signal=TERM",
        "15m",
        "node",
        "apps/alert-worker/dist/index.js",
        "--run",
      ],
      environment: {
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: "/app/certs/global-bundle.pem",
        PGDATABASE: databaseName,
        PGHOST: this.database.clusterEndpoint.hostname,
        PGPORT: this.database.clusterEndpoint.port.toString(),
        PGSSLMODE: "verify-full",
      },
      image: containerImage,
      logging: LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "worker",
      }),
      secrets: {
        PGPASSWORD: EcsSecret.fromSecretsManager(
          this.databaseCredentialsSecret,
          "password",
        ),
        PGUSER: EcsSecret.fromSecretsManager(
          this.databaseCredentialsSecret,
          "username",
        ),
        RENTCAST_API_KEY: EcsSecret.fromSecretsManager(
          this.applicationSecret,
          "RENTCAST_API_KEY",
        ),
        TELEGRAM_BOT_TOKEN: EcsSecret.fromSecretsManager(
          this.applicationSecret,
          "TELEGRAM_BOT_TOKEN",
        ),
        TELEGRAM_CHAT_ID: EcsSecret.fromSecretsManager(
          this.applicationSecret,
          "TELEGRAM_CHAT_ID",
        ),
      },
    });
    container.addUlimits({
      hardLimit: 1_024,
      name: UlimitName.NOFILE,
      softLimit: 1_024,
    });

    const showingListSchedule = props.showingListSchedule ?? {
      enabled: false,
      weekDay: "MON",
      hour: "8",
      minute: "0",
      timeZone: "America/Los_Angeles",
    };
    const showingListTaskDefinition = new FargateTaskDefinition(
      this,
      "ShowingListTaskDefinition",
      {
        cpu: 512,
        memoryLimitMiB: 1_024,
        runtimePlatform: {
          cpuArchitecture: CpuArchitecture.X86_64,
          operatingSystemFamily: OperatingSystemFamily.LINUX,
        },
      },
    );
    const showingListLogGroup = new LogGroup(this, "ShowingListWorkerLogGroup", {
      logGroupName: `/cpi/${deploymentStage}/showing-list-worker`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_WEEK,
    });
    const showingListContainer = showingListTaskDefinition.addContainer(
      "ShowingListWorker",
      {
        command: [
          "timeout",
          "--signal=TERM",
          "15m",
          "node",
          "apps/alert-worker/dist/index.js",
          "--run-showing-list",
        ],
        environment: {
          AWS_ACCOUNT_ID: this.account,
          NODE_ENV: "production",
          NODE_EXTRA_CA_CERTS: "/app/certs/global-bundle.pem",
          PGDATABASE: databaseName,
          PGHOST: this.database.clusterEndpoint.hostname,
          PGPORT: this.database.clusterEndpoint.port.toString(),
          PGSSLMODE: "verify-full",
          SHOWING_LIST_ARTIFACT_BUCKET:
            this.showingListArtifactBucket.bucketName,
          SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS: "900",
          SHOWING_LIST_TIME_ZONE: showingListSchedule.timeZone,
        },
        image: containerImage,
        logging: LogDrivers.awsLogs({
          logGroup: showingListLogGroup,
          streamPrefix: "worker",
        }),
        secrets: {
          OPENAI_API_KEY: EcsSecret.fromSecretsManager(
            this.applicationSecret,
            "OPENAI_API_KEY",
          ),
          PGPASSWORD: EcsSecret.fromSecretsManager(
            this.databaseCredentialsSecret,
            "password",
          ),
          PGUSER: EcsSecret.fromSecretsManager(
            this.databaseCredentialsSecret,
            "username",
          ),
          SHOWING_LIST_GENERATION_CONFIG: EcsSecret.fromSecretsManager(
            this.applicationSecret,
            "SHOWING_LIST_GENERATION_CONFIG",
          ),
          TELEGRAM_BOT_TOKEN: EcsSecret.fromSecretsManager(
            this.applicationSecret,
            "TELEGRAM_BOT_TOKEN",
          ),
          TELEGRAM_CHAT_ID: EcsSecret.fromSecretsManager(
            this.applicationSecret,
            "TELEGRAM_CHAT_ID",
          ),
        },
      },
    );
    showingListContainer.addUlimits({
      hardLimit: 1_024,
      name: UlimitName.NOFILE,
      softLimit: 1_024,
    });
    this.showingListArtifactBucket.grantPut(
      showingListTaskDefinition.taskRole,
      "showing-lists/current.pdf",
    );
    this.showingListArtifactBucket.grantRead(
      showingListTaskDefinition.taskRole,
      "showing-lists/current.pdf",
    );

    const deadLetterQueue = new Queue(this, "SchedulerDeadLetterQueue", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    const target = new EcsRunFargateTask(cluster, {
      assignPublicIp: true,
      deadLetterQueue,
      maxEventAge: Duration.hours(1),
      platformVersion: FargatePlatformVersion.LATEST,
      retryAttempts: 2,
      securityGroups: [workerSecurityGroup],
      taskDefinition,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });
    new Schedule(this, "DailySchedule", {
      description: "Run the property alert worker every morning",
      enabled: props.scheduleEnabled ?? false,
      schedule: ScheduleExpression.cron({
        hour: "8",
        minute: "0",
        timeZone: TimeZone.AMERICA_LOS_ANGELES,
      }),
      scheduleName: stageResourceName(
        deploymentStage,
        "daily-property-alert",
      ),
      target,
      timeWindow: TimeWindow.off(),
    });

    const showingListDeadLetterQueue = new Queue(
      this,
      "ShowingListSchedulerDeadLetterQueue",
      {
        encryption: QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(14),
      },
    );
    const showingListTarget = new EcsRunFargateTask(cluster, {
      assignPublicIp: true,
      deadLetterQueue: showingListDeadLetterQueue,
      maxEventAge: Duration.hours(1),
      platformVersion: FargatePlatformVersion.LATEST,
      retryAttempts: 2,
      securityGroups: [workerSecurityGroup],
      taskDefinition: showingListTaskDefinition,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });
    new Schedule(this, "WeeklyShowingListSchedule", {
      description: "Generate and deliver the current Showing List draft",
      enabled: showingListSchedule.enabled,
      schedule: ScheduleExpression.cron({
        hour: showingListSchedule.hour,
        minute: showingListSchedule.minute,
        timeZone: TimeZone.of(showingListSchedule.timeZone),
        weekDay: showingListSchedule.weekDay,
      }),
      scheduleName: stageResourceName(
        deploymentStage,
        "weekly-showing-list",
      ),
      target: showingListTarget,
      timeWindow: TimeWindow.off(),
    });
  }
}
