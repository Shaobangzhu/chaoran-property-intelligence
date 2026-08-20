import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";

import { AccountGuardrailsStack } from "../lib/accountGuardrailsStack.js";

function createTemplate(): Template {
  const app = new App();
  const stack = new AccountGuardrailsStack(app, "TestAccountGuardrailsStack", {
    env: {
      account: "111111111111",
      region: "us-west-2",
    },
    githubBranch: "main",
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
