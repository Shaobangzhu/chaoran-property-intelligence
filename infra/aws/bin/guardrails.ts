import { App } from "aws-cdk-lib";

import { createAccountGuardrailsStack } from "../lib/accountGuardrailsApplication.js";
import { resolveDeploymentEnvironment } from "../lib/deploymentEnvironment.js";

const app = new App();

createAccountGuardrailsStack(
  app,
  resolveDeploymentEnvironment(process.env),
);
