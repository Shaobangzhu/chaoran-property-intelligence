import {
  ArnFormat,
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

import { deploymentStageTagKey } from "./deploymentStage.js";

export interface AccountGuardrailsStackProps extends StackProps {
  githubDevAdminBootstrapEnvironment: string;
  githubDevDeploymentRegions?: string[];
  githubDevEnvironment: string;
  githubOwner: string;
  githubOwnerId: string;
  githubProductionAdminBootstrapEnvironment: string;
  githubProductionEnvironment: string;
  githubProductionDeploymentRegions?: string[];
  githubRepository: string;
  githubRepositoryId: string;
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
    const githubRepositorySubject = [
      `repo:${props.githubOwner}@${props.githubOwnerId}`,
      `${props.githubRepository}@${props.githubRepositoryId}`,
    ].join("/");
    const githubProductionSubject = [
      githubRepositorySubject,
      `environment:${props.githubProductionEnvironment}`,
    ].join(":");
    const githubDeployRole = new Role(this, "GitHubDeployRole", {
      assumedBy: new FederatedPrincipal(
        githubProvider.ref,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubProductionSubject,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description:
        "CDK deployment role for the CPI protected production environment",
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
        resources: (
          props.githubProductionDeploymentRegions ?? [this.region]
        ).map((region) =>
          this.formatArn({
            region,
            resource: "parameter",
            resourceName: "cdk-bootstrap/hnb659fds/version",
            service: "ssm",
          }),
        ),
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [
          this.formatArn({
            resource: "cpi-deployment-failures",
            service: "sns",
          }),
        ],
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
        ],
        resources: [
          {
            region: this.region,
            stackName: "ChaoranPropertyIntelligenceGuardrails",
          },
          {
            region: this.region,
            stackName: "ChaoranPropertyIntelligenceProduction",
          },
          {
            region: "us-east-1",
            stackName: "ChaoranPropertyIntelligenceProductionEdge",
          },
          {
            region: this.region,
            stackName:
              "ChaoranPropertyIntelligenceProductionPublicApplication",
          },
        ].map(({ region, stackName }) =>
          this.formatArn({
            region,
            resource: "stack",
            resourceName: `${stackName}/*`,
            service: "cloudformation",
          }),
        ),
      }),
    );
    const productionWebBucketName = `cpi-web-${this.account}-${this.region}`;
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "s3:GetBucketVersioning",
          "s3:ListBucket",
          "s3:ListBucketVersions",
        ],
        resources: [
          this.formatArn({
            account: "",
            region: "",
            resource: productionWebBucketName,
            service: "s3",
          }),
        ],
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
        resources: [
          this.formatArn({
            account: "",
            region: "",
            resource: productionWebBucketName,
            resourceName: "*",
            service: "s3",
          }),
        ],
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
        ],
        resources: [
          this.formatArn({
            region: "",
            resource: "distribution",
            resourceName: "*",
            service: "cloudfront",
          }),
        ],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${deploymentStageTagKey}`]: "production",
          },
        },
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["apprunner:DescribeService"],
        resources: [
          this.formatArn({
            resource: "service",
            resourceName: "cpi-api/*",
            service: "apprunner",
          }),
        ],
      }),
    );
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["apprunner:ListServices"],
        resources: ["*"],
      }),
    );

    const githubDevSubject = [
      githubRepositorySubject,
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
        resources: (props.githubDevDeploymentRegions ?? [this.region]).map(
          (region) =>
            this.formatArn({
              region,
              resource: "parameter",
              resourceName: "cdk-bootstrap/hnb659fds/version",
              service: "ssm",
            }),
        ),
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [
          this.formatArn({
            resource: "cpi-dev-deployment-failures",
            service: "sns",
          }),
        ],
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
        ],
        resources: [
          {
            region: this.region,
            stackName: "ChaoranPropertyIntelligenceGuardrails",
          },
          { region: this.region, stackName: "ChaoranPropertyIntelligenceDev" },
          {
            region: "us-east-1",
            stackName: "ChaoranPropertyIntelligenceDevEdge",
          },
          {
            region: this.region,
            stackName: "ChaoranPropertyIntelligenceDevPublicApplication",
          },
        ].map(({ region, stackName }) =>
          this.formatArn({
            region,
            resource: "stack",
            resourceName: `${stackName}/*`,
            service: "cloudformation",
          }),
        ),
      }),
    );
    const devWebBucketName = `cpi-dev-web-${this.account}-${this.region}`;
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "s3:GetBucketVersioning",
          "s3:ListBucket",
          "s3:ListBucketVersions",
        ],
        resources: [
          this.formatArn({
            account: "",
            region: "",
            resource: devWebBucketName,
            service: "s3",
          }),
        ],
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
        resources: [
          this.formatArn({
            account: "",
            region: "",
            resource: devWebBucketName,
            resourceName: "*",
            service: "s3",
          }),
        ],
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
        ],
        resources: [
          this.formatArn({
            region: "",
            resource: "distribution",
            resourceName: "*",
            service: "cloudfront",
          }),
        ],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${deploymentStageTagKey}`]: "dev",
          },
        },
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["apprunner:DescribeService"],
        resources: [
          this.formatArn({
            resource: "service",
            resourceName: "cpi-dev-api/*",
            service: "apprunner",
          }),
        ],
      }),
    );
    githubDevDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["apprunner:ListServices"],
        resources: ["*"],
      }),
    );

    const githubDevAdminBootstrapSubject = [
      githubRepositorySubject,
      `environment:${props.githubDevAdminBootstrapEnvironment}`,
    ].join(":");
    const githubDevAdminBootstrapRole = new Role(
      this,
      "GitHubDevAdminBootstrapRole",
      {
        assumedBy: new FederatedPrincipal(
          githubProvider.ref,
          {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub":
                githubDevAdminBootstrapSubject,
            },
          },
          "sts:AssumeRoleWithWebIdentity",
        ),
        description:
          "Run the reviewed one-time CPI DEV administrator bootstrap task",
        roleName: "cpi-github-dev-admin-bootstrap",
      },
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          this.formatArn({
            resource: "stack",
            resourceName: "ChaoranPropertyIntelligenceDev/*",
            service: "cloudformation",
          }),
        ],
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecs:RunTask"],
        conditions: {
          ArnLike: {
            "ecs:cluster": this.formatArn({
              resource: "cluster",
              resourceName: "ChaoranPropertyIntelligenceDev-Cluster*",
              service: "ecs",
            }),
          },
        },
        resources: [
          this.formatArn({
            resource: "task-definition",
            resourceName: "cpi-dev-admin-bootstrap:*",
            service: "ecs",
          }),
        ],
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecs:DescribeTaskDefinition", "ecs:DescribeTasks"],
        resources: ["*"],
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecr:DescribeImages"],
        resources: [
          this.formatArn({
            resource: "repository",
            resourceName: `cdk-hnb659fds-container-assets-${this.account}-${this.region}`,
            service: "ecr",
          }),
        ],
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        conditions: {
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        },
        resources: [
          "cpi-dev-admin-bootstrap-task",
          "cpi-dev-admin-bootstrap-execution",
        ].map((roleName) =>
          this.formatArn({
            region: "",
            resource: "role",
            resourceName: roleName,
            service: "iam",
          }),
        ),
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:TagResource",
        ],
        resources: [
          this.formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            resource: "secret",
            resourceName: "cpi/dev/admin-bootstrap/*",
            service: "secretsmanager",
          }),
        ],
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["scheduler:GetSchedule"],
        resources: [
          "cpi-dev-daily-property-alert",
          "cpi-dev-weekly-showing-list",
        ].map((scheduleName) =>
          this.formatArn({
            resource: "schedule",
            resourceName: `default/${scheduleName}`,
            service: "scheduler",
          }),
        ),
      }),
    );
    githubDevAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [
          this.formatArn({
            resource: "cpi-dev-deployment-failures",
            service: "sns",
          }),
        ],
      }),
    );

    const githubProductionAdminBootstrapSubject = [
      githubRepositorySubject,
      `environment:${props.githubProductionAdminBootstrapEnvironment}`,
    ].join(":");
    const githubProductionAdminBootstrapRole = new Role(
      this,
      "GitHubProductionAdminBootstrapRole",
      {
        assumedBy: new FederatedPrincipal(
          githubProvider.ref,
          {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub":
                githubProductionAdminBootstrapSubject,
            },
          },
          "sts:AssumeRoleWithWebIdentity",
        ),
        description:
          "Run the reviewed one-time CPI production administrator bootstrap task",
        roleName: "cpi-github-production-admin-bootstrap",
      },
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          this.formatArn({
            resource: "stack",
            resourceName: "ChaoranPropertyIntelligenceProduction/*",
            service: "cloudformation",
          }),
        ],
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecs:RunTask"],
        conditions: {
          ArnLike: {
            "ecs:cluster": this.formatArn({
              resource: "cluster",
              resourceName: "ChaoranPropertyIntelligenceProduction-Cluster*",
              service: "ecs",
            }),
          },
        },
        resources: [
          this.formatArn({
            resource: "task-definition",
            resourceName: "cpi-production-admin-bootstrap:*",
            service: "ecs",
          }),
        ],
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecs:DescribeTaskDefinition", "ecs:DescribeTasks"],
        resources: ["*"],
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecr:DescribeImages"],
        resources: [
          this.formatArn({
            resource: "repository",
            resourceName: `cdk-hnb659fds-container-assets-${this.account}-${this.region}`,
            service: "ecr",
          }),
        ],
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        conditions: {
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        },
        resources: [
          "cpi-production-admin-bootstrap-task",
          "cpi-production-admin-bootstrap-execution",
        ].map((roleName) =>
          this.formatArn({
            region: "",
            resource: "role",
            resourceName: roleName,
            service: "iam",
          }),
        ),
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:TagResource",
        ],
        resources: [
          this.formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            resource: "secret",
            resourceName: "cpi/production/admin-bootstrap/*",
            service: "secretsmanager",
          }),
        ],
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["scheduler:GetSchedule"],
        resources: [
          "cpi-daily-property-alert",
          "cpi-weekly-showing-list",
        ].map((scheduleName) =>
          this.formatArn({
            resource: "schedule",
            resourceName: `default/${scheduleName}`,
            service: "scheduler",
          }),
        ),
      }),
    );
    githubProductionAdminBootstrapRole.addToPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [
          this.formatArn({
            resource: "cpi-deployment-failures",
            service: "sns",
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
    new CfnOutput(this, "GitHubDevAdminBootstrapRoleArn", {
      value: githubDevAdminBootstrapRole.roleArn,
    });
    new CfnOutput(this, "GitHubProductionAdminBootstrapRoleArn", {
      value: githubProductionAdminBootstrapRole.roleArn,
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
