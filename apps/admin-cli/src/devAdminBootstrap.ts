import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { createAdmin } from "./createAdmin.js";
import { runDevAdminBootstrap } from "./runDevAdminBootstrap.js";

const secretsManager = new SecretsManagerClient({});

try {
  process.exitCode = await runDevAdminBootstrap(
    {
      environment: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
    },
    {
      async readSecret(secretArn) {
        const result = await secretsManager.send(
          new GetSecretValueCommand({
            SecretId: secretArn,
            VersionStage: "AWSCURRENT",
          }),
        );
        if (result.SecretString === undefined) {
          throw new Error("DEV administrator bootstrap secret was unavailable");
        }
        return result.SecretString;
      },
      createAdmin,
    },
  );
} finally {
  secretsManager.destroy();
}
