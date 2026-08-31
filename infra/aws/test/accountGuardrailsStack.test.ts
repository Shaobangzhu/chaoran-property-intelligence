import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { AccountGuardrailsStack } from "../lib/accountGuardrailsStack.js";

function createTemplate(): Template {
  const app = new App();
  const stack = new AccountGuardrailsStack(app, "TestAccountGuardrailsStack", {
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
    githubDevAdminBootstrapEnvironment: "development-admin-bootstrap",
    githubDevDeploymentRegions: ["us-west-2", "us-east-1"],
    githubDevEnvironment: "development",
    githubOwner: "Shaobangzhu",
    githubOwnerId: "8231137",
    githubProductionEnvironment: "production",
    githubProductionDeploymentRegions: ["us-west-2", "us-east-1"],
    githubRepository: "chaoran-property-intelligence",
    githubRepositoryId: "1338908571",
  });

  return Template.fromStack(stack);
}

describe("AccountGuardrailsStack", () => {
  it("retains a monthly gross-cost budget with staged notifications", () => {
    const template = createTemplate();

    template.hasParameter("AlertEmail", {
      AllowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      Type: "String",
    });
    template.hasParameter("MonthlyBudgetUsd", {
      Default: 20,
      MinValue: 1,
      Type: "Number",
    });
    template.hasResource("AWS::Budgets::Budget", {
      DeletionPolicy: "Retain",
      Properties: {
        Budget: {
          BudgetLimit: {
            Amount: { Ref: "MonthlyBudgetUsd" },
            Unit: "USD",
          },
          BudgetName: "cpi-monthly-gross-cost",
          BudgetType: "COST",
          CostTypes: Match.objectLike({
            IncludeCredit: false,
            IncludeRefund: false,
          }),
          TimeUnit: "MONTHLY",
        },
        NotificationsWithSubscribers: Match.arrayWith([
          notification("ACTUAL", 50),
          notification("ACTUAL", 80),
          notification("ACTUAL", 100),
          notification("FORECASTED", 100),
        ]),
      },
      UpdateReplacePolicy: "Retain",
    });
  });

  it("trusts only this repository's production environment through GitHub OIDC", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::IAM::OIDCProvider", {
      ClientIdList: ["sts.amazonaws.com"],
      Url: "https://token.actions.githubusercontent.com",
    });
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud":
                  "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:Shaobangzhu@8231137/chaoran-property-intelligence@1338908571:environment:production",
              },
            },
            Effect: "Allow",
          }),
        ]),
        Version: "2012-10-17",
      },
      RoleName: "cpi-github-deploy",
    });
  });

  it("lets the GitHub role assume only CDK bootstrap roles", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Resource: Match.objectLike({
              "Fn::Join": Match.anyValue(),
            }),
          }),
          Match.objectLike({
            Action: "ssm:GetParameter",
            Effect: "Allow",
          }),
        ]),
        Version: "2012-10-17",
      },
    });
  });

  it("adds an isolated DEV role for the protected development environment", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud":
                  "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:Shaobangzhu@8231137/chaoran-property-intelligence@1338908571:environment:development",
              },
            },
            Effect: "Allow",
          }),
        ]),
      },
      RoleName: "cpi-github-deploy-dev",
    });

    const policies = template.findResources("AWS::IAM::Policy");
    const devPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy.Properties?.Roles).includes(
        "GitHubDevDeployRole",
      ),
    );
    const devPolicyDocument = JSON.stringify(
      devPolicy?.Properties?.PolicyDocument,
    );

    expect(devPolicy).toBeDefined();
    expect(devPolicyDocument).toContain("cdk-hnb659fds-deploy-role-");
    expect(devPolicyDocument).toContain(
      "cdk-hnb659fds-file-publishing-role-",
    );
    expect(devPolicyDocument).toContain(
      "cdk-hnb659fds-image-publishing-role-",
    );
    expect(devPolicyDocument).toContain("cdk-hnb659fds-lookup-role-");
    expect(devPolicyDocument).toContain(
      "cdk-hnb659fds-deploy-role-111111111111-us-west-2",
    );
    expect(devPolicyDocument).toContain(
      "cdk-hnb659fds-deploy-role-111111111111-us-east-1",
    );
    expect(devPolicyDocument).toContain("sns:Publish");
    expect(devPolicyDocument).toContain(":sns:us-west-2:111111111111:");
    expect(devPolicyDocument).toContain("cpi-dev-deployment-failures");
    expect(devPolicyDocument).toContain(
      "parameter/cdk-bootstrap/hnb659fds/version",
    );
    expect(devPolicyDocument).toContain("ssm:us-east-1:111111111111");
    expect(devPolicyDocument).toContain("cloudformation:DescribeStacks");
    expect(devPolicyDocument).toContain("cloudformation:GetTemplate");
    expect(devPolicyDocument).toContain(
      "ChaoranPropertyIntelligenceDevPublicApplication/*",
    );
    expect(devPolicyDocument).toContain("cpi-dev-web-");
    expect(devPolicyDocument).toContain("cloudfront:CreateInvalidation");
    expect(devPolicyDocument).toContain("aws:ResourceTag/cpi:deployment-stage");
    expect(devPolicyDocument).toContain("apprunner:DescribeService");
    expect(devPolicyDocument).not.toContain("cdk-hnb659fds-*");

    const statements = devPolicy?.Properties?.PolicyDocument?.Statement as
      | Array<Record<string, unknown>>
      | undefined;
    const cloudFrontStatement = statements?.find((statement) =>
      JSON.stringify(statement.Action).includes(
        "cloudfront:CreateInvalidation",
      ),
    );
    const snsStatement = statements?.find(
      (statement) => statement.Action === "sns:Publish",
    );
    expect(cloudFrontStatement?.Condition).toEqual({
      StringEquals: { "aws:ResourceTag/cpi:deployment-stage": "dev" },
    });
    expect(snsStatement?.Condition).toBeUndefined();
  });

  it("adds a separate least-privilege DEV administrator bootstrap role", () => {
    const template = createTemplate();

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud":
                  "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:Shaobangzhu@8231137/chaoran-property-intelligence@1338908571:environment:development-admin-bootstrap",
              },
            },
            Effect: "Allow",
          }),
        ]),
      },
      RoleName: "cpi-github-dev-admin-bootstrap",
    });

    const policies = template.findResources("AWS::IAM::Policy");
    const bootstrapPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy.Properties?.Roles).includes(
        "GitHubDevAdminBootstrapRole",
      ),
    );
    const policyDocument = JSON.stringify(
      bootstrapPolicy?.Properties?.PolicyDocument,
    );

    expect(bootstrapPolicy).toBeDefined();
    expect(policyDocument).toContain("cloudformation:DescribeStacks");
    expect(policyDocument).toContain("ChaoranPropertyIntelligenceDev/*");
    expect(policyDocument).toContain("ecs:RunTask");
    expect(policyDocument).toContain("cpi-dev-admin-bootstrap:*");
    expect(policyDocument).toContain(
      "ChaoranPropertyIntelligenceDev-Cluster*",
    );
    expect(policyDocument).toContain("ecs:DescribeTasks");
    expect(policyDocument).toContain("ecr:DescribeImages");
    expect(policyDocument).toContain(
      "cdk-hnb659fds-container-assets-111111111111-us-west-2",
    );
    expect(policyDocument).toContain("iam:PassRole");
    expect(policyDocument).toContain("iam:PassedToService");
    expect(policyDocument).toContain("secretsmanager:CreateSecret");
    expect(policyDocument).toContain("secretsmanager:DeleteSecret");
    expect(policyDocument).toContain("cpi/dev/admin-bootstrap/*");
    expect(policyDocument).toContain("scheduler:GetSchedule");
    expect(policyDocument).toContain("cpi-dev-daily-property-alert");
    expect(policyDocument).toContain("sns:Publish");
    expect(policyDocument).not.toContain("secretsmanager:GetSecretValue");
    expect(policyDocument).not.toContain("ChaoranPropertyIntelligenceProduction");
    expect(policyDocument).not.toContain("sts:AssumeRole");
  });

  it("preserves the production role identity with exact environment trust", () => {
    const resources = createTemplate().toJSON().Resources;

    expect(resources.GitHubDeployRoleED73FD64).toBeDefined();
    expect(JSON.stringify(resources.GitHubDeployRoleED73FD64)).toContain(
      "repo:Shaobangzhu@8231137/chaoran-property-intelligence@1338908571:environment:production",
    );
  });

  it("bounds production public delivery permissions by stage and resource name", () => {
    const template = createTemplate();
    const policies = template.findResources("AWS::IAM::Policy");
    const productionPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy.Properties?.Roles).includes("GitHubDeployRole"),
    );
    const policyDocument = JSON.stringify(
      productionPolicy?.Properties?.PolicyDocument,
    );

    expect(productionPolicy).toBeDefined();
    expect(policyDocument).toContain("ssm:us-east-1:111111111111");
    expect(policyDocument).toContain(
      "ChaoranPropertyIntelligenceProductionPublicApplication/*",
    );
    expect(policyDocument).toContain("cpi-web-");
    expect(policyDocument).toContain("cpi-api/*");
    expect(policyDocument).toContain("cpi-deployment-failures");
    expect(policyDocument).toContain("cloudfront:CreateInvalidation");
    expect(policyDocument).toContain(
      "aws:ResourceTag/cpi:deployment-stage",
    );
    expect(policyDocument).not.toContain("cpi-production-web-");
  });
});

function notification(notificationType: string, threshold: number) {
  return Match.objectLike({
    Notification: {
      ComparisonOperator: "GREATER_THAN",
      NotificationType: notificationType,
      Threshold: threshold,
      ThresholdType: "PERCENTAGE",
    },
    Subscribers: [
      {
        Address: { Ref: "AlertEmail" },
        SubscriptionType: "EMAIL",
      },
    ],
  });
}
