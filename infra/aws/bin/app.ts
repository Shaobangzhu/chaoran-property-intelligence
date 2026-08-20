import path from "node:path";

import { App } from "aws-cdk-lib";

import { resolveDeploymentEnvironment } from "../lib/deploymentEnvironment.js";
import { PropertyAlertStack } from "../lib/propertyAlertStack.js";

const app = new App();
const scheduleEnabled = app.node.tryGetContext("scheduleEnabled") === "true";

new PropertyAlertStack(app, "ChaoranPropertyIntelligenceProduction", {
  env: resolveDeploymentEnvironment(process.env),
  repositoryRoot: path.resolve(process.cwd(), "../.."),
  scheduleEnabled,
});
