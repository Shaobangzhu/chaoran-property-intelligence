import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_API_VERSION = "2022-11-28";

export async function restorePreviousReportArtifacts({
  artifactPrefix,
  currentRunId,
  fetchImplementation = globalThis.fetch,
  maxArtifacts = 100,
  outputDirectory,
  repository,
  token,
  workflow,
}) {
  validateInput({
    artifactPrefix,
    currentRunId,
    maxArtifacts,
    outputDirectory,
    repository,
    token,
    workflow,
  });

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
  };
  const encodedRepository = repository
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const runsUrl = `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=completed&per_page=100`;
  const runsResponse = await fetchImplementation(runsUrl, { headers });
  const runsBody = await readJsonResponse(runsResponse, "workflow runs");
  const runs = Array.isArray(runsBody.workflow_runs)
    ? runsBody.workflow_runs
    : [];

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const restored = [];

  for (const run of runs) {
    if (
      restored.length >= maxArtifacts ||
      !Number.isInteger(run?.id) ||
      String(run.id) === String(currentRunId)
    ) {
      continue;
    }

    const artifactsUrl = `https://api.github.com/repos/${encodedRepository}/actions/runs/${run.id}/artifacts?per_page=100`;
    const artifactsResponse = await fetchImplementation(artifactsUrl, { headers });
    const artifactsBody = await readJsonResponse(
      artifactsResponse,
      `artifacts for workflow run ${run.id}`,
    );
    const artifact = Array.isArray(artifactsBody.artifacts)
      ? artifactsBody.artifacts.find(
          (candidate) =>
            candidate?.name === `${artifactPrefix}${run.id}` &&
            candidate.expired === false &&
            Number.isInteger(candidate.id) &&
            typeof candidate.archive_download_url === "string",
        )
      : undefined;
    if (artifact === undefined) {
      continue;
    }

    const archiveResponse = await fetchImplementation(
      artifact.archive_download_url,
      { headers, redirect: "follow" },
    );
    if (!archiveResponse.ok) {
      throw new Error(
        `GitHub report artifact download failed with HTTP ${archiveResponse.status}`,
      );
    }
    const outputZip = path.join(
      outputDirectory,
      `${run.id}-${artifact.id}.zip`,
    );
    await writeFile(outputZip, Buffer.from(await archiveResponse.arrayBuffer()));
    restored.push({ artifactId: String(artifact.id), runId: String(run.id) });
  }

  return restored;
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const restored = await restorePreviousReportArtifacts({
    artifactPrefix: args["artifact-prefix"],
    currentRunId: args["current-run-id"],
    maxArtifacts: readPositiveInteger(
      args["max-artifacts"] ?? "100",
      "max-artifacts",
    ),
    outputDirectory: args["output-directory"],
    repository: args.repository,
    token: process.env.GITHUB_TOKEN,
    workflow: args.workflow,
  });
  if (args["github-output"] !== undefined) {
    await appendFile(args["github-output"], `restored_count=${restored.length}\n`);
  }
  process.stdout.write(
    `Restored ${restored.length} prior report artifact(s).\n`,
  );
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`${name ?? "argument"} requires a value`);
    }
    values[name.slice(2)] = value;
  }
  for (const name of [
    "artifact-prefix",
    "current-run-id",
    "output-directory",
    "repository",
    "workflow",
  ]) {
    if (values[name] === undefined) {
      throw new Error(`--${name} is required`);
    }
  }
  return values;
}

function validateInput({
  artifactPrefix,
  currentRunId,
  maxArtifacts,
  outputDirectory,
  repository,
  token,
  workflow,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("repository must use the owner/name format");
  }
  if (!/^\d+$/u.test(String(currentRunId))) {
    throw new Error("currentRunId must contain digits only");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(workflow)) {
    throw new Error("workflow must be a workflow file name");
  }
  if (!/^[A-Za-z0-9_.-]+-$/u.test(artifactPrefix)) {
    throw new Error("artifactPrefix contains unsupported characters");
  }
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) {
    throw new Error("outputDirectory is required");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1 || maxArtifacts > 100) {
    throw new Error("maxArtifacts must be an integer from 1 through 100");
  }
}

function readPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

async function readJsonResponse(response, description) {
  if (!response.ok) {
    throw new Error(
      `GitHub ${description} request failed with HTTP ${response.status}`,
    );
  }
  return response.json();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
