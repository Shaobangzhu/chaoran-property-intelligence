import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";

import { EdgeSecurityStack } from "../lib/edgeSecurityStack.js";

function createTemplate(): Template {
  const app = new App();
  return Template.fromStack(
    new EdgeSecurityStack(app, "TestDevEdgeStack", {
      deploymentStage: "dev",
      env: { account: "111111111111", region: "us-east-1" },
    }),
  );
}

describe("EdgeSecurityStack", () => {
  it("creates a CloudFront WAF with common managed protections", () => {
    createTemplate().hasResourceProperties("AWS::WAFv2::WebACL", {
      DefaultAction: { Allow: {} },
      Name: "cpi-dev-public-web-api",
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "AwsManagedCommonRules",
          OverrideAction: { None: {} },
          Priority: 0,
          Statement: {
            ManagedRuleGroupStatement: {
              Name: "AWSManagedRulesCommonRuleSet",
              RuleActionOverrides: [
                {
                  ActionToUse: { Count: {} },
                  Name: "SizeRestrictions_BODY",
                },
              ],
              VendorName: "AWS",
            },
          },
        }),
      ]),
      Scope: "CLOUDFRONT",
    });
  });

  it("rate-limits only POST requests to the login route", () => {
    createTemplate().hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Action: { Block: {} },
          Name: "LoginRateLimit",
          Priority: 1,
          Statement: {
            RateBasedStatement: Match.objectLike({
              AggregateKeyType: "IP",
              Limit: 100,
              ScopeDownStatement: {
                AndStatement: {
                  Statements: Match.arrayWith([
                    Match.objectLike({
                      ByteMatchStatement: Match.objectLike({
                        FieldToMatch: { Method: {} },
                        SearchString: "POST",
                      }),
                    }),
                    Match.objectLike({
                      ByteMatchStatement: Match.objectLike({
                        FieldToMatch: { UriPath: {} },
                        SearchString: "/api/auth/login",
                      }),
                    }),
                  ]),
                },
              },
            }),
          },
        }),
      ]),
    });
  });

  it("uses a distinct production WAF identity", () => {
    const app = new App();
    const template = Template.fromStack(
      new EdgeSecurityStack(app, "TestProductionEdgeStack", {
        deploymentStage: "production",
        env: { account: "111111111111", region: "us-east-1" },
      }),
    );

    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Name: "cpi-public-web-api",
      Scope: "CLOUDFRONT",
    });
  });
});
