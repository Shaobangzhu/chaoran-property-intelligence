import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { describe, expect, it } from "vitest";

import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

function createTemplate(): Template {
  const app = new App();
  const stack = new PropertyAlertStack(app, "TestPropertyAlertStack", {
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
    containerImage: ContainerImage.fromRegistry("example.invalid/worker:test"),
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
  });

  return Template.fromStack(stack);
}

describe("PropertyAlertStack", () => {
  it("keeps the scheduled runtime bounded and avoids NAT gateways", () => {
    const template = createTemplate();

    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
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
    const template = createTemplate();

    template.hasResourceProperties("AWS::RDS::DBCluster", {
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
    template.resourceCountIs("AWS::RDS::DBInstance", 1);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.serverless",
    });
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Retain",
      Properties: {
        Name: "cpi/production/database",
      },
      UpdateReplacePolicy: "Retain",
    });
  });

  it("runs every day at 8 AM Los Angeles time with retries and a DLQ", () => {
    const template = createTemplate();

    template.resourceCountIs("AWS::SQS::Queue", 1);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      FlexibleTimeWindow: { Mode: "OFF" },
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

  it("retains worker logs for seven days", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });

  it("keeps one latest-only Showing List artifact bucket private", () => {
    const template = createTemplate();

    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResource("AWS::S3::Bucket", {
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
      template.findResources("AWS::S3::Bucket"),
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.Properties).not.toHaveProperty(
      "VersioningConfiguration",
    );
    expect(buckets[0]?.Properties).toHaveProperty("ObjectLockEnabled", false);
    expect(buckets[0]?.Properties).not.toHaveProperty("CorsConfiguration");
  });

  it("requires TLS for every Showing List artifact bucket request", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::S3::BucketPolicy", {
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
    const template = createTemplate();

    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      Description: "Allow PostgreSQL from the scheduled worker",
      FromPort: 5432,
      IpProtocol: "tcp",
      SourceSecurityGroupId: Match.anyValue(),
      ToPort: 5432,
    });
  });

  it("alerts on task startup failures and non-zero container exits", () => {
    const template = createTemplate();

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: "alerts@example.com",
      Protocol: "email",
    });
    template.resourceCountIs("AWS::Events::Rule", 2);
    template.hasResourceProperties("AWS::Events::Rule", {
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
    template.hasResourceProperties("AWS::Events::Rule", {
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
    const template = createParameterizedTemplate();

    template.hasParameter("AlertEmail", {
      AllowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      Type: "String",
    });
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: { Ref: "AlertEmail" },
      Protocol: "email",
    });
  });
});
