import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { describe, expect, it } from "vitest";

import { PropertyAlertStack } from "../lib/propertyAlertStack.js";
import { PublicApplicationStack } from "../lib/publicApplicationStack.js";

const environment = { account: "111111111111", region: "us-west-2" };

function createTemplates() {
  const app = new App();
  const foundation = new PropertyAlertStack(app, "TestDevFoundation", {
    containerImage: ContainerImage.fromRegistry("example.invalid/worker:test"),
    deploymentStage: "dev",
    env: environment,
    failureAlertEmail: "dev-alerts@example.com",
  });
  const publicApplication = new PublicApplicationStack(
    app,
    "TestDevPublicApplication",
    {
      apiImageSource: {
        imageIdentifier:
          "111111111111.dkr.ecr.us-west-2.amazonaws.com/cpi-api:test",
        repositoryArn:
          "arn:aws:ecr:us-west-2:111111111111:repository/cpi-api",
      },
      database: foundation.database,
      databaseCredentialsSecret: foundation.databaseCredentialsSecret,
      databaseSecurityGroup: foundation.databaseSecurityGroup,
      deploymentStage: "dev",
      deploymentFailureAlertEmail: "dev-deploy-alerts@example.com",
      env: environment,
      showingListArtifactBucket: foundation.showingListArtifactBucket,
      vpc: foundation.vpc,
      webAclArn:
        "arn:aws:wafv2:us-east-1:111111111111:global/webacl/cpi-dev/test",
    },
  );

  return {
    foundation: Template.fromStack(foundation),
    publicApplication: Template.fromStack(publicApplication),
  };
}

describe("PublicApplicationStack", () => {
  it("publishes deployment failures to a dedicated confirmed email topic", () => {
    const { publicApplication } = createTemplates();

    publicApplication.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "CPI dev deployment failures",
      TopicName: "cpi-dev-deployment-failures",
    });
    publicApplication.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: "dev-deploy-alerts@example.com",
      Protocol: "email",
    });
    publicApplication.hasOutput("DeploymentFailureTopicArn", {});
  });

  it("keeps public runtime resources out of the DEV foundation stack", () => {
    const { foundation } = createTemplates();

    foundation.resourceCountIs("AWS::AppRunner::Service", 0);
    foundation.resourceCountIs("AWS::CloudFront::Distribution", 0);
    foundation.resourceCountIs("AWS::EC2::VPCEndpoint", 0);
    foundation.resourceCountIs("AWS::WAFv2::WebACL", 0);
  });

  it("uses a private versioned S3 origin protected by CloudFront OAC", () => {
    const { publicApplication } = createTemplates();

    publicApplication.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "cpi-dev-web-111111111111-us-west-2",
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: "Enabled" },
    });
    publicApplication.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    publicApplication.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "s3:GetObject",
            Principal: { Service: "cloudfront.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("connects App Runner to isolated Aurora with bounded runtime secrets", () => {
    const { publicApplication } = createTemplates();

    publicApplication.hasResourceProperties("AWS::AppRunner::VpcConnector", {
      SecurityGroups: Match.anyValue(),
      Subnets: Match.anyValue(),
      VpcConnectorName: "cpi-dev-api-connector",
    });
    publicApplication.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      FromPort: 5432,
      IpProtocol: "tcp",
      SourceSecurityGroupId: Match.anyValue(),
      ToPort: 5432,
    });
    publicApplication.hasResourceProperties("AWS::AppRunner::Service", {
      HealthCheckConfiguration: Match.objectLike({
        Path: "/api/health",
        Protocol: "HTTP",
      }),
      NetworkConfiguration: {
        EgressConfiguration: Match.objectLike({ EgressType: "VPC" }),
        IngressConfiguration: { IsPubliclyAccessible: true },
        IpAddressType: "IPV4",
      },
      ServiceName: "cpi-dev-api",
      SourceConfiguration: Match.objectLike({
        AutoDeploymentsEnabled: false,
        ImageRepository: Match.objectLike({
          ImageConfiguration: Match.objectLike({
            Port: "3000",
            RuntimeEnvironmentSecrets: Match.arrayWith([
              Match.objectLike({ Name: "API_ORIGIN_VERIFICATION_SECRET" }),
              Match.objectLike({ Name: "DATABASE_CREDENTIALS_SECRET_JSON" }),
              Match.objectLike({ Name: "JWT_SIGNING_SECRET" }),
            ]),
            RuntimeEnvironmentVariables: Match.arrayWith([
              { Name: "API_DEPLOYMENT_MODE", Value: "production" },
              {
                Name: "API_TRUSTED_PUBLIC_ORIGIN_HEADER",
                Value: "x-cpi-viewer-origin",
              },
              { Name: "PGDATABASE", Value: "property_intelligence" },
              { Name: "PGSSLMODE", Value: "verify-full" },
            ]),
          }),
          ImageRepositoryType: "ECR",
        }),
      }),
    });

    const service = JSON.stringify(
      publicApplication.findResources("AWS::AppRunner::Service"),
    );
    expect(service).not.toContain('"Name":"PORT"');
    expect(service).not.toContain("API_PUBLIC_ORIGIN");
    expect(service).not.toContain("PGPASSWORD");
  });

  it("routes same-origin API traffic without caching or Host forwarding", () => {
    const { publicApplication } = createTemplates();
    const distributions = publicApplication.findResources(
      "AWS::CloudFront::Distribution",
    );
    const distribution = Object.values(distributions)[0];
    expect(distribution).toBeDefined();
    if (distribution === undefined) {
      throw new Error("Expected a CloudFront distribution");
    }
    const config = distribution.Properties.DistributionConfig;

    expect(config.WebACLId).toBe(
      "arn:aws:wafv2:us-east-1:111111111111:global/webacl/cpi-dev/test",
    );
    expect(distribution.Properties.Tags).toContainEqual({
      Key: "cpi:deployment-stage",
      Value: "dev",
    });
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.DefaultCacheBehavior.CachePolicyId).toBe(
      "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    );
    expect(config.CacheBehaviors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ PathPattern: "/assets/*" }),
        expect.objectContaining({ PathPattern: "/data/*" }),
        expect.objectContaining({
          PathPattern: "/api/*",
          ViewerProtocolPolicy: "redirect-to-https",
        }),
      ]),
    );
    const apiBehavior = config.CacheBehaviors.find(
      (behavior: { PathPattern: string }) => behavior.PathPattern === "/api/*",
    );
    expect(JSON.stringify(apiBehavior)).toContain(
      "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    );
    expect(JSON.stringify(apiBehavior)).toContain(
      "b689b0a8-53d0-40ab-baf2-68738e2966ac",
    );
  });

  it("overwrites the trusted viewer origin and rewrites only non-API routes", () => {
    const { publicApplication } = createTemplates();
    const functions = JSON.stringify(
      publicApplication.findResources("AWS::CloudFront::Function"),
    );

    expect(functions).toContain("x-cpi-viewer-origin");
    expect(functions).toContain("request.headers.host");
    expect(functions).toContain("uri.indexOf('/api/')");
    expect(functions).toContain("request.uri = '/index.html'");
  });

  it("adds response security headers and stage-scoped secrets", () => {
    const { publicApplication } = createTemplates();

    publicApplication.hasResourceProperties(
      "AWS::CloudFront::ResponseHeadersPolicy",
      {
        ResponseHeadersPolicyConfig: Match.objectLike({
          Name: "cpi-dev-security-headers",
          SecurityHeadersConfig: Match.objectLike({
            ContentTypeOptions: { Override: true },
            FrameOptions: { FrameOption: "DENY", Override: true },
          }),
        }),
      },
    );
    publicApplication.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "cpi/dev/api-auth/jwt-signing",
    });
    publicApplication.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "cpi/dev/api-auth/origin-verification",
    });
  });
});
