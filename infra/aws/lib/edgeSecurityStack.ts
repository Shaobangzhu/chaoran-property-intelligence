import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

import {
  stageResourceName,
  type DeploymentStage,
} from "./deploymentStage.js";

export interface EdgeSecurityStackProps extends StackProps {
  deploymentStage: DeploymentStage;
}

export class EdgeSecurityStack extends Stack {
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: EdgeSecurityStackProps) {
    super(scope, id, props);

    const webAcl = new CfnWebACL(this, "WebAcl", {
      defaultAction: { allow: {} },
      name: stageResourceName(props.deploymentStage, "public-web-api"),
      rules: [
        {
          name: "AwsManagedCommonRules",
          overrideAction: { none: {} },
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesCommonRuleSet",
              ruleActionOverrides: [
                {
                  actionToUse: { count: {} },
                  name: "SizeRestrictions_BODY",
                },
              ],
              vendorName: "AWS",
            },
          },
          visibilityConfig: visibilityConfig(
            `${props.deploymentStage}-aws-common-rules`,
          ),
        },
        {
          action: { block: {} },
          name: "LoginRateLimit",
          priority: 1,
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              limit: 100,
              scopeDownStatement: {
                andStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        fieldToMatch: { method: {} },
                        positionalConstraint: "EXACTLY",
                        searchString: "POST",
                        textTransformations: [
                          { priority: 0, type: "NONE" },
                        ],
                      },
                    },
                    {
                      byteMatchStatement: {
                        fieldToMatch: { uriPath: {} },
                        positionalConstraint: "EXACTLY",
                        searchString: "/api/auth/login",
                        textTransformations: [
                          { priority: 0, type: "NONE" },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
          visibilityConfig: visibilityConfig(
            `${props.deploymentStage}-login-rate-limit`,
          ),
        },
      ],
      scope: "CLOUDFRONT",
      visibilityConfig: visibilityConfig(
        `${props.deploymentStage}-public-web-api`,
      ),
    });
    this.webAclArn = webAcl.attrArn;

    new CfnOutput(this, "WebAclArn", { value: this.webAclArn });
  }
}

function visibilityConfig(metricName: string) {
  return {
    cloudWatchMetricsEnabled: true,
    metricName,
    sampledRequestsEnabled: true,
  };
}
