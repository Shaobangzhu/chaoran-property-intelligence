import path from "node:path";

import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  TimeZone,
} from "aws-cdk-lib";
import { Port, Vpc, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  FargatePlatformVersion,
  FargateTaskDefinition,
  LogDrivers,
  Secret as EcsSecret,
  UlimitName,
} from "aws-cdk-lib/aws-ecs";
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
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

const databaseName = "property_intelligence";

export interface PropertyAlertStackProps extends StackProps {
  containerImage?: ContainerImage;
  repositoryRoot?: string;
  scheduleEnabled?: boolean;
}

export class PropertyAlertStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: PropertyAlertStackProps = {},
  ) {
    super(scope, id, props);

    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: SubnetType.PUBLIC,
        },
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
        vpc,
      },
    );
    const databaseSecurityGroup = new SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        allowAllOutbound: false,
        description: "Aurora access restricted to the scheduled worker",
        vpc,
      },
    );
    databaseSecurityGroup.addIngressRule(
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
    const databaseCredentialsSecret = new Secret(
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
        removalPolicy: RemovalPolicy.RETAIN,
        secretName: "cpi/production/database",
      },
    );
    const database = new DatabaseCluster(this, "Database", {
      backup: {
        retention: Duration.days(7),
      },
      credentials: Credentials.fromSecret(databaseCredentialsSecret),
      defaultDatabaseName: databaseName,
      deletionProtection: true,
      engine: databaseEngine,
      parameterGroup: databaseParameterGroup,
      removalPolicy: RemovalPolicy.RETAIN,
      securityGroups: [databaseSecurityGroup],
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      serverlessV2MaxCapacity: 1,
      serverlessV2MinCapacity: 0,
      storageEncrypted: true,
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      writer: ClusterInstance.serverlessV2("Writer", {
        autoMinorVersionUpgrade: true,
      }),
    });

    const applicationSecret = new Secret(this, "ApplicationSecret", {
      description: "RentCast and Telegram credentials for the property worker",
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
      secretName: "cpi/production/application",
    });

    const cluster = new Cluster(this, "Cluster", {
      vpc,
    });
    const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    const logGroup = new LogGroup(this, "WorkerLogGroup", {
      logGroupName: "/cpi/production/alert-worker",
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
        PGHOST: database.clusterEndpoint.hostname,
        PGPORT: database.clusterEndpoint.port.toString(),
        PGSSLMODE: "verify-full",
      },
      image:
        props.containerImage ??
        ContainerImage.fromAsset(
          props.repositoryRoot ?? path.resolve(process.cwd(), "../.."),
        ),
      logging: LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "worker",
      }),
      secrets: {
        PGPASSWORD: EcsSecret.fromSecretsManager(
          databaseCredentialsSecret,
          "password",
        ),
        PGUSER: EcsSecret.fromSecretsManager(
          databaseCredentialsSecret,
          "username",
        ),
        RENTCAST_API_KEY: EcsSecret.fromSecretsManager(
          applicationSecret,
          "RENTCAST_API_KEY",
        ),
        TELEGRAM_BOT_TOKEN: EcsSecret.fromSecretsManager(
          applicationSecret,
          "TELEGRAM_BOT_TOKEN",
        ),
        TELEGRAM_CHAT_ID: EcsSecret.fromSecretsManager(
          applicationSecret,
          "TELEGRAM_CHAT_ID",
        ),
      },
    });
    container.addUlimits({
      hardLimit: 1_024,
      name: UlimitName.NOFILE,
      softLimit: 1_024,
    });

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
      scheduleName: "cpi-daily-property-alert",
      target,
      timeWindow: TimeWindow.off(),
    });
  }
}
