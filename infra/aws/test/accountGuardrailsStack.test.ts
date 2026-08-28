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
    githubBranch: "main",
    githubDevDeploymentRegions: ["us-west-2", "us-east-1"],
    githubDevEnvironment: "development",
    githubOwner: "Shaobangzhu",
    githubRepository: "chaoran-property-intelligence",
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

  it("trusts only this repository's main branch through GitHub OIDC", () => {
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
                  "repo:Shaobangzhu/chaoran-property-intelligence:ref:refs/heads/main",
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
                  "repo:Shaobangzhu/chaoran-property-intelligence:environment:development",
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
    expect(devPolicyDocument).not.toContain("cdk-hnb659fds-*");
  });

  it("preserves the production role identity and exact main-branch trust", () => {
    const resources = createTemplate().toJSON().Resources;

    expect(resources.GitHubDeployRoleED73FD64).toBeDefined();
    expect(JSON.stringify(resources.GitHubDeployRoleED73FD64)).toContain(
      "repo:Shaobangzhu/chaoran-property-intelligence:ref:refs/heads/main",
    );
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
