import path from "node:path";

import { App } from "aws-cdk-lib";

import { AccountGuardrailsStack } from "../lib/accountGuardrailsStack.js";
import { resolveDeploymentEnvironment } from "../lib/deploymentEnvironment.js";
import { resolveDeploymentStage } from "../lib/deploymentStage.js";
import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

const app = new App();
const environment = resolveDeploymentEnvironment(process.env);
const deploymentStage = resolveDeploymentStage(
  app.node.tryGetContext("targetStage") as unknown,
);

const guardrailsStack = new AccountGuardrailsStack(
  app,
  "ChaoranPropertyIntelligenceGuardrails",
  {
    env: environment,
    githubBranch: "main",
    githubDevEnvironment: "development",
    githubOwner: "Shaobangzhu",
    githubRepository: "chaoran-property-intelligence",
  },
);
if (deploymentStage === "production") {
  const productionStack = new PropertyAlertStack(
    app,
    "ChaoranPropertyIntelligenceProduction",
    {
      env: environment,
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      scheduleEnabled: app.node.tryGetContext("scheduleEnabled") === "true",
      showingListSchedule: resolveShowingListSchedule(app),
    },
  );
  productionStack.addStackDependency(
    guardrailsStack,
    "Deploy account cost and access guardrails before application resources",
  );
} else {
  const devStack = new PropertyAlertStack(
    app,
    "ChaoranPropertyIntelligenceDev",
    {
      deploymentStage: "dev",
      env: environment,
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
