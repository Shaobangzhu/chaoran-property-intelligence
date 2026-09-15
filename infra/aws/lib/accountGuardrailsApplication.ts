import type { App, Environment } from "aws-cdk-lib";

import { AccountGuardrailsStack } from "./accountGuardrailsStack.js";

export const accountGuardrailsStackId =
  "ChaoranPropertyIntelligenceGuardrails";

export function createAccountGuardrailsStack(
  app: App,
  environment: Environment,
): AccountGuardrailsStack {
  return new AccountGuardrailsStack(app, accountGuardrailsStackId, {
    env: environment,
    githubDevAdminBootstrapEnvironment: "development-admin-bootstrap",
    githubDevDeploymentRegions: ["us-west-2", "us-east-1"],
    githubDevEnvironment: "development",
    githubOwner: "Shaobangzhu",
    githubOwnerId: "8231137",
    githubProductionAdminBootstrapEnvironment: "production-admin-bootstrap",
    githubProductionEnvironment: "production",
    githubProductionDeploymentRegions: ["us-west-2", "us-east-1"],
    githubRepository: "chaoran-property-intelligence",
    githubRepositoryId: "1338908571",
  });
}
