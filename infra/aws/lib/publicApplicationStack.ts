import path from "node:path";

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import { CfnService, CfnVpcConnector } from "aws-cdk-lib/aws-apprunner";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import {
  HttpOrigin,
  S3BucketOrigin,
} from "aws-cdk-lib/aws-cloudfront-origins";
import {
  GatewayVpcEndpointAwsService,
  GatewayVpcEndpoint,
  CfnSecurityGroupIngress,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import type { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

import {
  stageResourceName,
  type DeploymentStage,
} from "./deploymentStage.js";

const databaseName = "property_intelligence";
const originVerificationHeaderName = "x-cpi-origin-verification";
const trustedViewerOriginHeaderName = "x-cpi-viewer-origin";

export interface PublicApplicationStackProps extends StackProps {
  apiImageSource?: {
    imageIdentifier: string;
    repositoryArn: string;
  };
  database: DatabaseCluster;
  databaseCredentialsSecret: Secret;
  databaseSecurityGroup: SecurityGroup;
  deploymentStage: DeploymentStage;
  repositoryRoot?: string;
  showingListArtifactBucket: IBucket;
  vpc: Vpc;
  webAclArn: string;
}

export class PublicApplicationStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: PublicApplicationStackProps,
  ) {
    super(scope, id, props);

    const isProduction = props.deploymentStage === "production";
    const webBucket = new Bucket(this, "WebBucket", {
      autoDeleteObjects: !isProduction,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          enabled: true,
          noncurrentVersionExpiration: Duration.days(isProduction ? 30 : 7),
        },
      ],
      minimumTLSVersion: 1.2,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: isProduction
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      versioned: true,
    });
    const jwtSigningSecret = new Secret(this, "JwtSigningSecret", {
      description: `CPI ${props.deploymentStage} API JWT signing secret`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
      removalPolicy: isProduction
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      secretName: `cpi/${props.deploymentStage}/api-auth/jwt-signing`,
    });
    const originVerificationSecret = new Secret(
      this,
      "OriginVerificationSecret",
      {
        description: `CPI ${props.deploymentStage} CloudFront origin secret`,
        generateSecretString: {
          excludePunctuation: true,
          passwordLength: 64,
        },
        removalPolicy: isProduction
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
        secretName: `cpi/${props.deploymentStage}/api-auth/origin-verification`,
      },
    );

    const apiSecurityGroup = new SecurityGroup(this, "ApiSecurityGroup", {
      allowAllOutbound: false,
      description: `Outbound access for the ${props.deploymentStage} App Runner API`,
      vpc: props.vpc,
    });
    apiSecurityGroup.addEgressRule(
      props.databaseSecurityGroup,
      Port.tcp(5_432),
      "Allow PostgreSQL to Aurora",
    );
    const databaseIngress = new CfnSecurityGroupIngress(
      this,
      "DatabaseIngressFromApi",
      {
        description: "Allow PostgreSQL from App Runner",
        fromPort: 5_432,
        groupId: props.databaseSecurityGroup.securityGroupId,
        ipProtocol: "tcp",
        sourceSecurityGroupId: apiSecurityGroup.securityGroupId,
        toPort: 5_432,
      },
    );
    const s3Endpoint = new GatewayVpcEndpoint(this, "ApiS3Endpoint", {
      service: GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
      vpc: props.vpc,
    });
    apiSecurityGroup.addEgressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "Allow HTTPS where isolated-subnet routes provide a destination",
    );

    const connector = new CfnVpcConnector(this, "ApiVpcConnector", {
      securityGroups: [apiSecurityGroup.securityGroupId],
      subnets: props.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
      vpcConnectorName: stageResourceName(
        props.deploymentStage,
        "api-connector",
      ),
    });

    const imageAccessRole = new Role(this, "ApiImageAccessRole", {
      assumedBy: new ServicePrincipal("build.apprunner.amazonaws.com"),
      description: `Allow App Runner to pull the ${props.deploymentStage} API image`,
    });
    const imageSource = resolveApiImageSource(this, props, imageAccessRole);
    const instanceRole = new Role(this, "ApiInstanceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
      description: `Runtime permissions for the ${props.deploymentStage} API`,
    });
    props.databaseCredentialsSecret.grantRead(instanceRole);
    jwtSigningSecret.grantRead(instanceRole);
    originVerificationSecret.grantRead(instanceRole);
    props.showingListArtifactBucket.grantRead(
      instanceRole,
      "showing-lists/current.pdf",
    );

    const service = new CfnService(this, "ApiService", {
      healthCheckConfiguration: {
        healthyThreshold: 1,
        interval: 10,
        path: "/api/health",
        protocol: "HTTP",
        timeout: 5,
        unhealthyThreshold: 5,
      },
      instanceConfiguration: {
        cpu: "0.25 vCPU",
        instanceRoleArn: instanceRole.roleArn,
        memory: "0.5 GB",
      },
      networkConfiguration: {
        egressConfiguration: {
          egressType: "VPC",
          vpcConnectorArn: connector.attrVpcConnectorArn,
        },
        ingressConfiguration: { isPubliclyAccessible: true },
        ipAddressType: "IPV4",
      },
      serviceName: stageResourceName(props.deploymentStage, "api"),
      sourceConfiguration: {
        authenticationConfiguration: {
          accessRoleArn: imageAccessRole.roleArn,
        },
        autoDeploymentsEnabled: false,
        imageRepository: {
          imageConfiguration: {
            port: "3000",
            runtimeEnvironmentSecrets: [
              keyValue(
                "API_ORIGIN_VERIFICATION_SECRET",
                originVerificationSecret.secretArn,
              ),
              keyValue(
                "DATABASE_CREDENTIALS_SECRET_JSON",
                props.databaseCredentialsSecret.secretArn,
              ),
              keyValue("JWT_SIGNING_SECRET", jwtSigningSecret.secretArn),
            ],
            runtimeEnvironmentVariables: [
              keyValue("API_DEPLOYMENT_MODE", "production"),
              keyValue(
                "API_TRUSTED_PUBLIC_ORIGIN_HEADER",
                trustedViewerOriginHeaderName,
              ),
              keyValue("AWS_ACCOUNT_ID", this.account),
              keyValue("JWT_AUDIENCE", `cpi-${props.deploymentStage}-web`),
              keyValue("JWT_ISSUER", `cpi-${props.deploymentStage}-api`),
              keyValue("NODE_EXTRA_CA_CERTS", "/app/certs/global-bundle.pem"),
              keyValue("PGDATABASE", databaseName),
              keyValue("PGHOST", props.database.clusterEndpoint.hostname),
              keyValue(
                "PGPORT",
                props.database.clusterEndpoint.port.toString(),
              ),
              keyValue("PGSSLMODE", "verify-full"),
              keyValue(
                "SHOWING_LIST_ARTIFACT_BUCKET",
                props.showingListArtifactBucket.bucketName,
              ),
            ],
          },
          imageIdentifier: imageSource.imageIdentifier,
          imageRepositoryType: "ECR",
        },
      },
    });
    service.node.addDependency(databaseIngress);
    service.node.addDependency(imageAccessRole);
    service.node.addDependency(instanceRole);
    service.node.addDependency(s3Endpoint);

    const viewerRequestFunction = new Function(this, "ViewerRequestFunction", {
      code: FunctionCode.fromInline(viewerRequestFunctionCode()),
      comment: "Set the trusted viewer origin and rewrite React routes",
      functionName: stageResourceName(
        props.deploymentStage,
        "viewer-request",
      ),
      runtime: FunctionRuntime.JS_2_0,
    });
    const responseHeadersPolicy = new ResponseHeadersPolicy(
      this,
      "ResponseHeadersPolicy",
      {
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Permissions-Policy",
              override: true,
              value: "camera=(), microphone=(), geolocation=()",
            },
          ],
        },
        responseHeadersPolicyName: stageResourceName(
          props.deploymentStage,
          "security-headers",
        ),
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            override: true,
            referrerPolicy: HeadersReferrerPolicy.NO_REFERRER,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            override: true,
            preload: false,
          },
          xssProtection: {
            modeBlock: true,
            override: true,
            protection: true,
          },
        },
      },
    );
    const functionAssociations = [
      {
        eventType: FunctionEventType.VIEWER_REQUEST,
        function: viewerRequestFunction,
      },
    ];
    const webOrigin = S3BucketOrigin.withOriginAccessControl(webBucket);
    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        compress: true,
        functionAssociations,
        origin: webOrigin,
        responseHeadersPolicy,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      enableIpv6: true,
      webAclId: props.webAclArn,
    });
    for (const pathPattern of ["/assets/*", "/data/*"]) {
      distribution.addBehavior(pathPattern, webOrigin, {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      });
    }
    distribution.addBehavior(
      "/api/*",
      new HttpOrigin(service.attrServiceUrl, {
        customHeaders: {
          [originVerificationHeaderName]:
            originVerificationSecret.secretValue.unsafeUnwrap(),
        },
        protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
      }),
      {
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        compress: true,
        functionAssociations,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );

    new CfnOutput(this, "ApplicationUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "ApiServiceUrl", {
      value: `https://${service.attrServiceUrl}`,
    });
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "WebBucketName", { value: webBucket.bucketName });
  }
}

function keyValue(name: string, value: string) {
  return { name, value };
}

function resolveApiImageSource(
  scope: Construct,
  props: PublicApplicationStackProps,
  imageAccessRole: Role,
) {
  if (props.apiImageSource !== undefined) {
    imageAccessRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        resources: [props.apiImageSource.repositoryArn],
      }),
    );
    imageAccessRole.addToPolicy(
      new PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    return props.apiImageSource;
  }

  const image = new DockerImageAsset(scope, "ApiImage", {
    directory: props.repositoryRoot ?? path.resolve(process.cwd(), "../.."),
    file: "Dockerfile.api",
    platform: Platform.LINUX_AMD64,
  });
  image.repository.grantPull(imageAccessRole);
  return {
    imageIdentifier: image.imageUri,
    repositoryArn: image.repository.repositoryArn,
  };
}

function viewerRequestFunctionCode(): string {
  return `function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host) {
    request.headers['${trustedViewerOriginHeaderName}'] = { value: 'https://' + host };
  }
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  var isApi = uri === '/api' || uri.indexOf('/api/') === 0;
  if (!isApi && (lastSegment === '' || lastSegment.indexOf('.') === -1)) {
    request.uri = '/index.html';
  }
  return request;
}`;
}
