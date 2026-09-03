import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applicationSecretName,
  createApplicationSecret,
  type ApplicationSecretStage,
} from "../lib/applicationSecret.js";

const secret = createApplicationSecret(process.env);
const options = readOptions(process.argv.slice(2));
const awsProfile = process.env.CPI_AWS_PROFILE?.trim() || "cpi-admin";

if (!options.applyChanges) {
  console.log(
    `${options.stage} application secret configuration is valid. No AWS changes made.`,
  );
} else {
  const cliInput = JSON.stringify({
    SecretId: applicationSecretName(options.stage),
    SecretString: JSON.stringify(secret),
  });
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "cpi-application-secret-"),
  );
  const inputPath = path.join(temporaryDirectory, "input.json");
  let result: ReturnType<typeof spawnSync>;

  try {
    writeFileSync(inputPath, cliInput, { encoding: "utf8", mode: 0o600 });
    result = spawnSync(
      "aws",
      [
        "secretsmanager",
        "put-secret-value",
        "--cli-input-json",
        `file://${inputPath}`,
        "--profile",
        awsProfile,
        "--region",
        "us-west-2",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `AWS CLI failed to update the application secret (exit ${result.status ?? "unknown"})`,
    );
  }

  console.log(
    `${options.stage} application secret updated without displaying values.`,
  );
}

function readOptions(argv: readonly string[]): {
  readonly applyChanges: boolean;
  readonly stage: ApplicationSecretStage;
} {
  let applyChanges = false;
  let stage: ApplicationSecretStage = "production";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      applyChanges = true;
    } else if (argument === "--stage") {
      const value = argv[index + 1];
      if (value !== "dev" && value !== "production") {
        throw new Error("--stage must be dev or production");
      }
      stage = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { applyChanges, stage };
}
