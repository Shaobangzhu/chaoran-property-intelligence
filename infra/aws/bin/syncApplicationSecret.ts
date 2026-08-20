import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApplicationSecret } from "../lib/applicationSecret.js";

const secret = createApplicationSecret(process.env);
const applyChanges = process.argv.includes("--apply");
const awsProfile = process.env.CPI_AWS_PROFILE?.trim() || "cpi-admin";

if (!applyChanges) {
  console.log("Application secret configuration is valid. No AWS changes made.");
} else {
  const cliInput = JSON.stringify({
    SecretId: "cpi/production/application",
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

  console.log("Production application secret updated without displaying values.");
}
