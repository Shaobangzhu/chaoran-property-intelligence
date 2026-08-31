import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { beforeAll, describe, expect, it } from "vitest";

import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

function createTemplate(): Template {
  const app = new App();
  const stack = new PropertyAlertStack(app, "TestPropertyAlertStack", {
    adminContainerImage: ContainerImage.fromRegistry(
      "example.invalid/admin:test",
    ),
    containerImage: ContainerImage.fromRegistry("example.invalid/worker:test"),
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
    failureAlertEmail: "alerts@example.com",
  });

  return Template.fromStack(stack);
}

function createParameterizedTemplate(): Template {
  const app = new App();
  const stack = new PropertyAlertStack(app, "ParameterizedPropertyAlertStack", {
    adminContainerImage: ContainerImage.fromRegistry(
      "example.invalid/admin:test",
    ),
    containerImage: ContainerImage.fromRegistry("example.invalid/worker:test"),
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
  });

  return Template.fromStack(stack);
}

function createDevTemplate(): Template {
  const app = new App();
  const stack = new PropertyAlertStack(app, "TestDevPropertyAlertStack", {
    adminContainerImage: ContainerImage.fromRegistry(
      "example.invalid/admin:test",
    ),
    containerImage: ContainerImage.fromRegistry("example.invalid/worker:test"),
    deploymentStage: "dev",
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
    failureAlertEmail: "dev-alerts@example.com",
  });

  return Template.fromStack(stack);
}

describe("PropertyAlertStack", () => {
  let devTemplate: Template;
  let parameterizedTemplate: Template;
  let productionTemplate: Template;

  beforeAll(() => {
    devTemplate = createDevTemplate();
    parameterizedTemplate = createParameterizedTemplate();
    productionTemplate = createTemplate();
  }, 20_000);

  it("preserves critical production logical and physical identities", () => {
    const resources = productionTemplate.toJSON().Resources;

    expect(resources.DatabaseB269D8BB).toBeDefined();
    expect(resources.DatabaseCredentialsSecret7483BC14).toBeDefined();
    expect(resources.Vpc8378EB38).toBeDefined();
    expect(resources.DailySchedule68BF5767).toBeDefined();
    expect(resources.WeeklyShowingListScheduleAE80C2CD).toBeDefined();
    expect(JSON.stringify(resources)).toContain("cpi/production/database");
    expect(JSON.stringify(resources)).toContain("cpi-daily-property-alert");
    expect(JSON.stringify(resources)).toContain("cpi-weekly-showing-list");
  });

  it("isolates DEV names, data resources, and disabled schedules", () => {
    const resources = JSON.stringify(devTemplate.toJSON().Resources);

    expect(resources).toContain("cpi/dev/database");
    expect(resources).toContain("cpi/dev/application");
    expect(resources).toContain("/cpi/dev/alert-worker");
    expect(resources).toContain("/cpi/dev/showing-list-worker");
    expect(resources).toContain("cpi-dev-worker-failures");
    expect(resources).toContain("cpi-dev-daily-property-alert");
    expect(resources).toContain("cpi-dev-weekly-showing-list");
    expect(resources).not.toContain("cpi/production/");
    expect(resources).not.toContain("/cpi/production/");

    devTemplate.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "cpi-dev-daily-property-alert",
      State: "DISABLED",
    });
    devTemplate.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "cpi-dev-weekly-showing-list",
      State: "DISABLED",
    });
  });

  it("adds one DEV-only administrator bootstrap task with no schedule", () => {
    devTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Family: "cpi-dev-admin-bootstrap",
      Memory: "512",
      NetworkMode: "awsvpc",
      RequiresCompatibilities: ["FARGATE"],
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Command: [
            "timeout",
            "--signal=TERM",
            "5m",
            "node",
            "apps/admin-cli/dist/devAdminBootstrap.js",
          ],
          Environment: Match.arrayWith([
            { Name: "AWS_REGION", Value: "us-west-2" },
            { Name: "CPI_DEPLOYMENT_STAGE", Value: "dev" },
            { Name: "PGSSLMODE", Value: "verify-full" },
          ]),
          Image: "example.invalid/admin:test",
          Name: "DevAdminBootstrap",
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "PGPASSWORD" }),
            Match.objectLike({ Name: "PGUSER" }),
          ]),
        }),
      ]),
    });
    devTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/cpi/dev/admin-bootstrap",
      RetentionInDays: 7,
    });
    devTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "cpi-dev-admin-bootstrap-task",
    });
    devTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "cpi-dev-admin-bootstrap-execution",
    });
    const policies = JSON.stringify(
      devTemplate.findResources("AWS::IAM::Policy"),
    );
    expect(policies).toContain("secretsmanager:GetSecretValue");
    expect(policies).toContain("cpi/dev/admin-bootstrap/*");

    const devResources = devTemplate.toJSON().Resources as Record<
      string,
      { Type?: string }
    >;
    expect(
      Object.values(devResources).filter(
        (resource) => resource.Type === "AWS::ECS::TaskDefinition",
      ),
    ).toHaveLength(3);
    expect(
      Object.values(devResources).filter(
        (resource) => resource.Type === "AWS::Scheduler::Schedule",
      ),
    ).toHaveLength(2);
  });

  it("adds an isolated production administrator path without DEV identities", () => {
    const production = JSON.stringify(productionTemplate.toJSON());

    expect(production).not.toContain("cpi-dev-admin-bootstrap");
    expect(production).not.toContain("DevAdminBootstrap");
    expect(production).toContain("cpi-production-admin-bootstrap");
    expect(production).toContain("ProductionAdminBootstrap");
    expect(production).toContain("cpi/production/admin-bootstrap/*");
    productionTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Family: "cpi-production-admin-bootstrap",
      Memory: "512",
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Command: [
            "timeout",
            "--signal=TERM",
            "5m",
            "node",
            "apps/admin-cli/dist/productionAdminBootstrap.js",
          ],
          Environment: Match.arrayWith([
            { Name: "CPI_DEPLOYMENT_STAGE", Value: "production" },
            { Name: "PGSSLMODE", Value: "verify-full" },
          ]),
          Name: "ProductionAdminBootstrap",
        }),
      ]),
    });
    productionTemplate.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      Properties: {
        LogGroupName: "/cpi/production/admin-bootstrap",
        RetentionInDays: 30,
      },
      UpdateReplacePolicy: "Retain",
    });
    productionTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "cpi-production-admin-bootstrap-task",
    });
    productionTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "cpi-production-admin-bootstrap-execution",
    });
    productionTemplate.resourceCountIs("AWS::ECS::TaskDefinition", 3);
    productionTemplate.resourceCountIs("AWS::Scheduler::Schedule", 2);
  });

  it("makes DEV data disposable without weakening production retention", () => {
    devTemplate.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Delete",
      Properties: { Name: "cpi/dev/database" },
      UpdateReplacePolicy: "Delete",
    });
    devTemplate.hasResource("AWS::RDS::DBCluster", {
      DeletionPolicy: "Delete",
      Properties: {
        BackupRetentionPeriod: 1,
        DeletionProtection: false,
      },
      UpdateReplacePolicy: "Delete",
    });

    productionTemplate.hasResource("AWS::RDS::DBCluster", {
      DeletionPolicy: "Retain",
      Properties: {
        BackupRetentionPeriod: 7,
        DeletionProtection: true,
      },
      UpdateReplacePolicy: "Retain",
    });
  });

  it("keeps the scheduled runtime bounded and avoids NAT gateways", () => {
    productionTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
    productionTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      NetworkMode: "awsvpc",
      RequiresCompatibilities: ["FARGATE"],
      RuntimePlatform: {
        CpuArchitecture: "X86_64",
        OperatingSystemFamily: "LINUX",
      },
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Command: [
            "timeout",
            "--signal=TERM",
            "15m",
            "node",
            "apps/alert-worker/dist/index.js",
            "--run",
          ],
          Environment: Match.arrayWith([
            {
              Name: "NODE_EXTRA_CA_CERTS",
              Value: "/app/certs/global-bundle.pem",
            },
            { Name: "PGSSLMODE", Value: "verify-full" },
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "PGPASSWORD" }),
            Match.objectLike({ Name: "RENTCAST_API_KEY" }),
            Match.objectLike({ Name: "TELEGRAM_BOT_TOKEN" }),
            Match.objectLike({ Name: "TELEGRAM_CHAT_ID" }),
          ]),
        }),
      ]),
    });
  });

  it("uses one encrypted Aurora Serverless v2 writer that can pause", () => {
    productionTemplate.hasResourceProperties("AWS::RDS::DBCluster", {
      BackupRetentionPeriod: 7,
      DatabaseName: "property_intelligence",
      DeletionProtection: true,
      Engine: "aurora-postgresql",
      ServerlessV2ScalingConfiguration: {
        MaxCapacity: 1,
        MinCapacity: 0,
        SecondsUntilAutoPause: 300,
      },
      StorageEncrypted: true,
    });
    productionTemplate.resourceCountIs("AWS::RDS::DBInstance", 1);
    productionTemplate.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.serverless",
    });
    productionTemplate.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Retain",
      Properties: {
        Name: "cpi/production/database",
      },
      UpdateReplacePolicy: "Retain",
    });
  });

  it("runs every day at 8 AM Los Angeles time with retries and a DLQ", () => {
    productionTemplate.resourceCountIs("AWS::SQS::Queue", 2);
    productionTemplate.hasResourceProperties("AWS::Scheduler::Schedule", {
      FlexibleTimeWindow: { Mode: "OFF" },
      Name: "cpi-daily-property-alert",
      ScheduleExpression: "cron(0 8 * * ? *)",
      ScheduleExpressionTimezone: "America/Los_Angeles",
      State: "DISABLED",
      Target: Match.objectLike({
        DeadLetterConfig: Match.objectLike({
          Arn: Match.anyValue(),
        }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 3_600,
          MaximumRetryAttempts: 2,
        },
      }),
    });
  });

  it("adds a separate disabled weekly Showing List task and schedule", () => {
    productionTemplate.resourceCountIs("AWS::ECS::TaskDefinition", 3);
    productionTemplate.resourceCountIs("AWS::Scheduler::Schedule", 2);
    productionTemplate.resourceCountIs("AWS::Logs::LogGroup", 3);
    productionTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "512",
      Memory: "1024",
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Command: [
            "timeout",
            "--signal=TERM",
            "15m",
            "node",
            "apps/alert-worker/dist/index.js",
            "--run-showing-list",
          ],
          Environment: Match.arrayWith([
            { Name: "AWS_ACCOUNT_ID", Value: "111111111111" },
            {
              Name: "SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS",
              Value: "900",
            },
            {
              Name: "SHOWING_LIST_TIME_ZONE",
              Value: "America/Los_Angeles",
            },
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "OPENAI_API_KEY" }),
            Match.objectLike({ Name: "SHOWING_LIST_GENERATION_CONFIG" }),
            Match.objectLike({ Name: "TELEGRAM_BOT_TOKEN" }),
            Match.objectLike({ Name: "TELEGRAM_CHAT_ID" }),
          ]),
        }),
      ]),
    });
    productionTemplate.hasResourceProperties("AWS::Scheduler::Schedule", {
      FlexibleTimeWindow: { Mode: "OFF" },
      Name: "cpi-weekly-showing-list",
      ScheduleExpression: "cron(0 8 ? * MON *)",
      ScheduleExpressionTimezone: "America/Los_Angeles",
      State: "DISABLED",
      Target: Match.objectLike({
        DeadLetterConfig: Match.objectLike({
          Arn: Match.anyValue(),
        }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 3_600,
          MaximumRetryAttempts: 2,
        },
      }),
    });

    const policies = JSON.stringify(
      productionTemplate.findResources("AWS::IAM::Policy"),
    );
    expect(policies).toContain("showing-lists/current.pdf");
    expect(policies).toContain("s3:GetObject");
    expect(policies).toContain("s3:PutObject");
  });

  it("keeps the deployed bootstrap Secret template stable", () => {
    const secrets = JSON.stringify(
      productionTemplate.findResources("AWS::SecretsManager::Secret"),
    );

    expect(secrets).toContain("RENTCAST_API_KEY");
    expect(secrets).toContain("TELEGRAM_BOT_TOKEN");
    expect(secrets).not.toContain("OPENAI_API_KEY");
    expect(secrets).not.toContain("SHOWING_LIST_GENERATION_CONFIG");
  });

  it("retains worker logs for seven days", () => {
    productionTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });

  it("keeps one latest-only Showing List artifact bucket private", () => {
    productionTemplate.resourceCountIs("AWS::S3::Bucket", 1);
    productionTemplate.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      Properties: {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
              Id: "AbortIncompleteMultipartUploads",
              Status: "Enabled",
            }),
          ]),
        },
        OwnershipControls: {
          Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
      UpdateReplacePolicy: "Delete",
    });

    const buckets = Object.values(
      productionTemplate.findResources("AWS::S3::Bucket"),
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.Properties).not.toHaveProperty(
      "VersioningConfiguration",
    );
    expect(buckets[0]?.Properties).toHaveProperty("ObjectLockEnabled", false);
    expect(buckets[0]?.Properties).not.toHaveProperty("CorsConfiguration");
  });

  it("requires TLS for every Showing List artifact bucket request", () => {
    productionTemplate.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "s3:*",
            Condition: {
              Bool: { "aws:SecureTransport": "false" },
            },
            Effect: "Deny",
            Principal: { AWS: "*" },
          }),
          Match.objectLike({
            Action: "s3:*",
            Condition: {
              NumericLessThan: { "s3:TlsVersion": 1.2 },
            },
            Effect: "Deny",
            Principal: { AWS: "*" },
          }),
        ]),
      },
    });
  });

  it("permits PostgreSQL only from the worker security group", () => {
    productionTemplate.hasResourceProperties(
      "AWS::EC2::SecurityGroupIngress",
      {
        Description: "Allow PostgreSQL from the scheduled worker",
        FromPort: 5432,
        IpProtocol: "tcp",
        SourceSecurityGroupId: Match.anyValue(),
        ToPort: 5432,
      },
    );
  });

  it("alerts on task startup failures and non-zero container exits", () => {
    productionTemplate.resourceCountIs("AWS::SNS::Topic", 1);
    productionTemplate.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: "alerts@example.com",
      Protocol: "email",
    });
    productionTemplate.resourceCountIs("AWS::Events::Rule", 2);
    productionTemplate.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        detail: Match.objectLike({
          lastStatus: ["STOPPED"],
          stopCode: ["TaskFailedToStart"],
        }),
        "detail-type": ["ECS Task State Change"],
        source: ["aws.ecs"],
      }),
      State: "ENABLED",
    });
    productionTemplate.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        detail: Match.objectLike({
          containers: {
            exitCode: [{ "anything-but": 0 }],
          },
          lastStatus: ["STOPPED"],
        }),
        "detail-type": ["ECS Task State Change"],
        source: ["aws.ecs"],
      }),
      State: "ENABLED",
    });
  });

  it("requires the failure alert email as a deployment parameter", () => {
    parameterizedTemplate.hasParameter("AlertEmail", {
      AllowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      Type: "String",
    });
    parameterizedTemplate.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: { Ref: "AlertEmail" },
      Protocol: "email",
    });
  });
});
