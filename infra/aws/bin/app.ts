import path from "node:path";

import { App } from "aws-cdk-lib";

import { AccountGuardrailsStack } from "../lib/accountGuardrailsStack.js";
import { EdgeSecurityStack } from "../lib/edgeSecurityStack.js";
import { PublicApplicationStack } from "../lib/publicApplicationStack.js";
import { resolveDeploymentEnvironment } from "../lib/deploymentEnvironment.js";
import { resolveDeploymentStage } from "../lib/deploymentStage.js";
import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

const app = new App();
const environment = resolveDeploymentEnvironment(process.env);
const deploymentStage = resolveDeploymentStage(
  app.node.tryGetContext("targetStage") as unknown,
);
const releaseSha = resolveReleaseSha(app);
const priceEstimationRuntimeEnabled = readBooleanContext(
  app,
  "priceEstimationRuntimeEnabled",
  false,
);
const priceEstimationOpenAiEnabled = readBooleanContext(
  app,
  "priceEstimationOpenAiEnabled",
  false,
);

const guardrailsStack = new AccountGuardrailsStack(
  app,
  "ChaoranPropertyIntelligenceGuardrails",
  {
    env: environment,
    githubDevAdminBootstrapEnvironment: "development-admin-bootstrap",
    githubDevDeploymentRegions: ["us-west-2", "us-east-1"],
    githubDevEnvironment: "development",
    githubOwner: "Shaobangzhu",
    githubOwnerId: "8231137",
    githubProductionAdminBootstrapEnvironment:
      "production-admin-bootstrap",
    githubProductionEnvironment: "production",
    githubProductionDeploymentRegions: ["us-west-2", "us-east-1"],
    githubRepository: "chaoran-property-intelligence",
    githubRepositoryId: "1338908571",
  },
);
if (deploymentStage === "production") {
  const productionStack = new PropertyAlertStack(
    app,
    "ChaoranPropertyIntelligenceProduction",
    {
      env: environment,
      priceEstimationRuntimeEnabled,
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      scheduleEnabled: app.node.tryGetContext("scheduleEnabled") === "true",
      showingListSchedule: resolveShowingListSchedule(app),
    },
  );
  productionStack.addStackDependency(
    guardrailsStack,
    "Deploy account cost and access guardrails before application resources",
  );
  const edgeStack = new EdgeSecurityStack(
    app,
    "ChaoranPropertyIntelligenceProductionEdge",
    {
      crossRegionReferences: true,
      deploymentStage: "production",
      env: { account: environment.account, region: "us-east-1" },
    },
  );
  edgeStack.addStackDependency(
    guardrailsStack,
    "Deploy account access guardrails before production edge resources",
  );
  const publicApplicationStack = new PublicApplicationStack(
    app,
    "ChaoranPropertyIntelligenceProductionPublicApplication",
    {
      crossRegionReferences: true,
      applicationSecret: productionStack.applicationSecret,
      database: productionStack.database,
      databaseCredentialsSecret: productionStack.databaseCredentialsSecret,
      databaseSecurityGroup: productionStack.databaseSecurityGroup,
      deploymentStage: "production",
      env: environment,
      priceEstimationOpenAiEnabled,
      priceEstimationRuntimeEnabled,
      releaseSha,
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      showingListArtifactBucket: productionStack.showingListArtifactBucket,
      vpc: productionStack.vpc,
      webAclArn: edgeStack.webAclArn,
    },
  );
  publicApplicationStack.addStackDependency(
    productionStack,
    "Deploy the retained production foundation before its public runtime",
  );
  publicApplicationStack.addStackDependency(
    edgeStack,
    "Deploy the production CloudFront WAF before the public runtime",
  );
} else {
  const devStack = new PropertyAlertStack(
    app,
    "ChaoranPropertyIntelligenceDev",
    {
      deploymentStage: "dev",
      env: environment,
      priceEstimationRuntimeEnabled,
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      scheduleEnabled: false,
      showingListSchedule: {
        enabled: false,
        weekDay: "MON",
        hour: "8",
        minute: "0",
        timeZone: "America/Los_Angeles",
      },
    },
  );
  devStack.addStackDependency(
    guardrailsStack,
    "Deploy account access guardrails before DEV application resources",
  );
  const edgeStack = new EdgeSecurityStack(
    app,
    "ChaoranPropertyIntelligenceDevEdge",
    {
      crossRegionReferences: true,
      deploymentStage: "dev",
      env: { account: environment.account, region: "us-east-1" },
    },
  );
  edgeStack.addStackDependency(
    guardrailsStack,
    "Deploy account access guardrails before DEV edge resources",
  );
  const publicApplicationStack = new PublicApplicationStack(
    app,
    "ChaoranPropertyIntelligenceDevPublicApplication",
    {
      crossRegionReferences: true,
      applicationSecret: devStack.applicationSecret,
      database: devStack.database,
      databaseCredentialsSecret: devStack.databaseCredentialsSecret,
      databaseSecurityGroup: devStack.databaseSecurityGroup,
      deploymentStage: "dev",
      env: environment,
      priceEstimationOpenAiEnabled,
      priceEstimationRuntimeEnabled,
      releaseSha,
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      showingListArtifactBucket: devStack.showingListArtifactBucket,
      vpc: devStack.vpc,
      webAclArn: edgeStack.webAclArn,
    },
  );
  publicApplicationStack.addStackDependency(
    devStack,
    "Deploy the isolated DEV foundation before its public runtime",
  );
  publicApplicationStack.addStackDependency(
    edgeStack,
    "Deploy the DEV CloudFront WAF before the public runtime",
  );
}

function resolveReleaseSha(application: App): string {
  const value = application.node.tryGetContext("releaseSha") as unknown;
  if (value === undefined) {
    return "0".repeat(40);
  }
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("releaseSha must be a lowercase 40-character Git SHA");
  }
  return value;
}

function resolveShowingListSchedule(application: App) {
  const enabled = readBooleanContext(
    application,
    "showingListScheduleEnabled",
    false,
  );
  const weekDay = readStringContext(
    application,
    "showingListScheduleWeekday",
    "MON",
  ).toUpperCase();
  const hour = readIntegerContext(
    application,
    "showingListScheduleHour",
    8,
    0,
    23,
  );
  const minute = readIntegerContext(
    application,
    "showingListScheduleMinute",
    0,
    0,
    59,
  );
  const timeZone = readStringContext(
    application,
    "showingListScheduleTimeZone",
    "America/Los_Angeles",
  );

  if (!/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/.test(weekDay)) {
    throw new Error("showingListScheduleWeekday was invalid");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error("showingListScheduleTimeZone was invalid");
  }

  return {
    enabled,
    weekDay,
    hour: hour.toString(),
    minute: minute.toString(),
    timeZone,
  };
}

function readBooleanContext(
  application: App,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = application.node.tryGetContext(key) as unknown;
  if (value === undefined) {
    return defaultValue;
  }
  if (value !== "true" && value !== "false") {
    throw new Error(`${key} must be true or false`);
  }
  return value === "true";
}

function readStringContext(
  application: App,
  key: string,
  defaultValue: string,
): string {
  const value = application.node.tryGetContext(key) as unknown;
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readIntegerContext(
  application: App,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = application.node.tryGetContext(key) as unknown;
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} was invalid`);
  }
  return parsed;
}
