import {
  CfnOutput,
  CfnParameter,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  CfnOIDCProvider,
  FederatedPrincipal,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface AccountGuardrailsStackProps extends StackProps {
  githubDevDeploymentRegions?: string[];
  githubBranch: string;
  githubDevEnvironment: string;
  githubOwner: string;
  githubRepository: string;
}

export class AccountGuardrailsStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: AccountGuardrailsStackProps,
  ) {
    super(scope, id, props);

    const alertEmail = new CfnParameter(this, "AlertEmail", {
      allowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      constraintDescription: "must be a valid email address",
      type: "String",
    });
    const monthlyBudgetUsd = new CfnParameter(this, "MonthlyBudgetUsd", {
      default: 20,
      minValue: 1,
      type: "Number",
    });
    const budget = new CfnBudget(this, "MonthlyGrossCostBudget", {
      budget: {
        budgetLimit: {
          amount: monthlyBudgetUsd.valueAsNumber,
          unit: "USD",
        },
        budgetName: "cpi-monthly-gross-cost",
        budgetType: "COST",
        costTypes: {
          includeCredit: false,
          includeRefund: false,
        },
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [
        budgetNotification(alertEmail.valueAsString, "ACTUAL", 50),
        budgetNotification(alertEmail.valueAsString, "ACTUAL", 80),
        budgetNotification(alertEmail.valueAsString, "ACTUAL", 100),
        budgetNotification(alertEmail.valueAsString, "FORECASTED", 100),
      ],
    });
    budget.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const githubProvider = new CfnOIDCProvider(this, "GitHubOidcProvider", {
      clientIdList: ["sts.amazonaws.com"],
      url: "https://token.actions.githubusercontent.com",
    });
    const githubSubject = [
      `repo:${props.githubOwner}/${props.githubRepository}`,
      `ref:refs/heads/${props.githubBranch}`,
    ].join(":");
    const githubDeployRole = new Role(this, "GitHubDeployRole", {
      assumedBy: new FederatedPrincipal(
        githubProvider.ref,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubSubject,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: "CDK deployment role for the CPI main branch",
      roleName: "cpi-github-deploy",
    });
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          this.formatArn({
            region: "",
            resource: "role",
            resourceName: "cdk-hnb659fds-*",
            service: "iam",
          }),
        ],
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          this.formatArn({
            resource: "parameter",
            resourceName: "cdk-bootstrap/hnb659fds/version",
            service: "ssm",
          }),
        ],
      }),
    );

    const githubDevSubject = [
      `repo:${props.githubOwner}/${props.githubRepository}`,
      `environment:${props.githubDevEnvironment}`,
    ].join(":");
    const githubDevDeployRole = new Role(this, "GitHubDevDeployRole", {
      assumedBy: new FederatedPrincipal(
        githubProvider.ref,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubDevSubject,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: "CDK deployment role for the CPI development environment",
      roleName: "cpi-github-deploy-dev",
    });
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          "deploy-role",
          "file-publishing-role",
          "image-publishing-role",
          "lookup-role",
        ].flatMap((roleType) =>
          (props.githubDevDeploymentRegions ?? [this.region]).map((region) =>
            this.formatArn({
              region: "",
              resource: "role",
              resourceName: `cdk-hnb659fds-${roleType}-${this.account}-${region}`,
              service: "iam",
            }),
          ),
        ),
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          this.formatArn({
            resource: "parameter",
            resourceName: "cdk-bootstrap/hnb659fds/version",
            service: "ssm",
          }),
        ],
      }),
    );

    new CfnOutput(this, "GitHubDeployRoleArn", {
      value: githubDeployRole.roleArn,
    });
    new CfnOutput(this, "GitHubDevDeployRoleArn", {
      value: githubDevDeployRole.roleArn,
    });
  }
}

function budgetNotification(
  emailAddress: string,
  notificationType: "ACTUAL" | "FORECASTED",
  threshold: number,
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      comparisonOperator: "GREATER_THAN",
      notificationType,
      threshold,
      thresholdType: "PERCENTAGE",
    },
    subscribers: [
      {
        address: emailAddress,
        subscriptionType: "EMAIL",
      },
    ],
  };
}
