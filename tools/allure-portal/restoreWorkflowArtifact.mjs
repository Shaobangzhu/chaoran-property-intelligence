import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_API_VERSION = "2022-11-28";

export async function restorePreviousWorkflowArtifact({
  artifactName,
  currentRunId,
  fetchImplementation = globalThis.fetch,
  outputZip,
  repository,
  token,
  workflow,
}) {
  validateInput({
    artifactName,
    currentRunId,
    outputZip,
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
  const runsUrl = `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=completed&per_page=50`;
  const runsResponse = await fetchImplementation(runsUrl, { headers });
  const runsBody = await readJsonResponse(runsResponse, "workflow runs");
  const runs = Array.isArray(runsBody.workflow_runs)
    ? runsBody.workflow_runs
    : [];

  for (const run of runs) {
    if (!Number.isInteger(run?.id) || String(run.id) === String(currentRunId)) {
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
            candidate?.name === artifactName &&
            candidate.expired === false &&
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
        `GitHub artifact download failed with HTTP ${archiveResponse.status}`,
      );
    }
    await mkdir(path.dirname(outputZip), { recursive: true });
    await writeFile(outputZip, Buffer.from(await archiveResponse.arrayBuffer()));
    return { found: true, sourceRunId: String(run.id) };
  }

  await rm(outputZip, { force: true });
  return { found: false, sourceRunId: undefined };
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const result = await restorePreviousWorkflowArtifact({
    artifactName: args["artifact-name"],
    currentRunId: args["current-run-id"],
    outputZip: args.output,
    repository: args.repository,
    token: process.env.GITHUB_TOKEN,
    workflow: args.workflow,
  });
  if (args["github-output"] !== undefined) {
    await appendFile(
      args["github-output"],
      `found=${result.found}\nsource_run_id=${result.sourceRunId ?? ""}\n`,
    );
  }
  process.stdout.write(
    result.found
      ? `Restored workflow artifact from run ${result.sourceRunId}.\n`
      : "No prior workflow artifact was available.\n",
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
    "artifact-name",
    "current-run-id",
    "output",
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
  artifactName,
  currentRunId,
  outputZip,
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
  if (!/^[A-Za-z0-9_.-]+$/u.test(artifactName)) {
    throw new Error("artifactName contains unsupported characters");
  }
  if (typeof outputZip !== "string" || outputZip.length === 0) {
    throw new Error("outputZip is required");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required");
  }
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
