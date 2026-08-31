import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  createDeploymentImpact,
  readChangedFilesFromGit,
} from "./deploymentImpact.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

export function evaluateDeployedRelease({
  apiRelease,
  candidateSha,
  changedFiles,
  isAncestor,
  webRelease,
}) {
  validateRelease("Web", webRelease);
  validateRelease("API", apiRelease);
  validateSha("candidate", candidateSha);

  if (
    webRelease.gitSha !== apiRelease.gitSha ||
    webRelease.stage !== apiRelease.stage
  ) {
    throw new Error("Web and API release identities do not match");
  }
  if (webRelease.stage !== "dev") {
    throw new Error(`Expected DEV release stage, received ${webRelease.stage}`);
  }
  if (!isAncestor) {
    throw new Error("Deployed DEV SHA is not an ancestor of the tested candidate");
  }

  const impact = createDeploymentImpact(changedFiles, {
    emptyMeansDeploy: false,
  });
  const deploymentSkipped = webRelease.gitSha !== candidateSha;

  if (deploymentSkipped && impact.deployRequired) {
    throw new Error(
      "Candidate contains deployable changes after the deployed DEV SHA: " +
        impact.deployableFiles.slice(0, 10).join(", "),
    );
  }

  return {
    candidateSha,
    deployedSha: webRelease.gitSha,
    deploymentSkipped,
    impact,
    stage: webRelease.stage,
  };
}

export function formatReleaseVerificationMarkdown(result) {
  return [
    "## AWS DEV Release Identity",
    "",
    `Tested candidate SHA: \`${result.candidateSha}\``,
    `Deployed DEV SHA: \`${result.deployedSha}\``,
    `Deployment stage: \`${result.stage}\``,
    `Deployment skipped for intervening non-runtime changes: ${result.deploymentSkipped ? "yes" : "no"}`,
    `Intervening changed files: ${result.impact.changedFiles.length}`,
    `Intervening deployable files: ${result.impact.deployableFiles.length}`,
    "",
  ].join("\n");
}

function validateRelease(label, release) {
  if (release === null || typeof release !== "object" || Array.isArray(release)) {
    throw new Error(`${label} release identity must be an object`);
  }
  validateSha(`${label} release`, release.gitSha);
  if (typeof release.stage !== "string" || release.stage.length === 0) {
    throw new Error(`${label} release stage is invalid`);
  }
}

function validateSha(label, sha) {
  if (typeof sha !== "string" || !shaPattern.test(sha)) {
    throw new Error(`${label} SHA must be a lowercase 40-character Git SHA`);
  }
}

async function fetchRelease(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Release identity request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function parseCliArguments(argv) {
  const args = {
    baseUrl: undefined,
    candidateSha: undefined,
    githubEnv: process.env.GITHUB_ENV,
    githubOutput: process.env.GITHUB_OUTPUT,
    summaryFile: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--base-url" && next !== undefined) {
      args.baseUrl = next;
      index += 1;
    } else if (arg === "--candidate-sha" && next !== undefined) {
      args.candidateSha = next;
      index += 1;
    } else if (arg === "--github-env" && next !== undefined) {
      args.githubEnv = next;
      index += 1;
    } else if (arg === "--github-output" && next !== undefined) {
      args.githubOutput = next;
      index += 1;
    } else if (arg === "--summary-file" && next !== undefined) {
      args.summaryFile = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (args.baseUrl === undefined || args.candidateSha === undefined) {
    throw new Error("--base-url and --candidate-sha are required");
  }

  return args;
}

function writeOptional(filePath, content, options = undefined) {
  if (filePath === undefined || filePath.trim().length === 0) {
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, options);
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2));
  const origin = new URL(args.baseUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("--base-url must be an HTTPS origin without credentials");
  }
  const [webRelease, apiRelease] = await Promise.all([
    fetchRelease(new URL("/release.json", origin)),
    fetchRelease(new URL("/api/release", origin)),
  ]);
  const deployedSha = webRelease?.gitSha;
  const ancestorResult = shaPattern.test(deployedSha ?? "")
    ? spawnSync(
        "git",
        ["merge-base", "--is-ancestor", deployedSha, args.candidateSha],
        { stdio: "ignore" },
      )
    : { status: 1 };
  const isAncestor = ancestorResult.status === 0;
  const changedFiles = isAncestor
    ? readChangedFilesFromGit(deployedSha, args.candidateSha)
    : [];
  const result = evaluateDeployedRelease({
    apiRelease,
    candidateSha: args.candidateSha,
    changedFiles,
    isAncestor,
    webRelease,
  });
  const markdown = formatReleaseVerificationMarkdown(result);

  writeOptional(
    args.githubEnv,
    `CPI_EXPECTED_RELEASE_SHA=${result.deployedSha}\nCPI_EXPECTED_DEPLOYMENT_STAGE=dev\n`,
    { flag: "a" },
  );
  writeOptional(
    args.githubOutput,
    `deployed_sha=${result.deployedSha}\ndeployment_skipped=${result.deploymentSkipped}\n`,
    { flag: "a" },
  );
  writeOptional(args.summaryFile, markdown);
  console.log(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
