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
});
