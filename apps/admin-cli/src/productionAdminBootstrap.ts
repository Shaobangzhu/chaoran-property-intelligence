import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { createAdmin } from "./createAdmin.js";
import { runProductionAdminBootstrap } from "./runProductionAdminBootstrap.js";

const secretsManager = new SecretsManagerClient({});

try {
  process.exitCode = await runProductionAdminBootstrap(
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
          throw new Error(
            "Production administrator bootstrap secret was unavailable",
          );
        }
        return result.SecretString;
      },
      createAdmin,
    },
  );
} finally {
  secretsManager.destroy();
}
