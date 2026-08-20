import path from "node:path";

import { App } from "aws-cdk-lib";

import { AccountGuardrailsStack } from "../lib/accountGuardrailsStack.js";
import { resolveDeploymentEnvironment } from "../lib/deploymentEnvironment.js";
import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

const app = new App();
const scheduleEnabled = app.node.tryGetContext("scheduleEnabled") === "true";
const environment = resolveDeploymentEnvironment(process.env);

const guardrailsStack = new AccountGuardrailsStack(
  app,
  "ChaoranPropertyIntelligenceGuardrails",
  {
    env: environment,
    githubBranch: "main",
    githubOwner: "Shaobangzhu",
    githubRepository: "chaoran-property-intelligence",
  },
);
const productionStack = new PropertyAlertStack(
  app,
  "ChaoranPropertyIntelligenceProduction",
  {
    env: environment,
    repositoryRoot: path.resolve(process.cwd(), "../.."),
    scheduleEnabled,
  },
);
productionStack.addStackDependency(
  guardrailsStack,
  "Deploy account cost and access guardrails before application resources",
);
