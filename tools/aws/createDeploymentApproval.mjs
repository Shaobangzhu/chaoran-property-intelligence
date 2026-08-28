import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const gitShaPattern = /^[a-f0-9]{40}$/u;

export function createDeploymentApproval({ commit, rawDiff, stage }) {
  if (!gitShaPattern.test(commit)) {
    throw new Error("commit must be a lowercase 40-character Git SHA");
  }
  if (stage !== "production") {
    throw new Error("stage must be production");
  }
  const normalizedDiff = rawDiff
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replaceAll("\r\n", "\n")
    .trimEnd();
  const diffSha256 = sha256(normalizedDiff);
  const approvalDigest = sha256(
    JSON.stringify({ commit, diffSha256, schemaVersion: 1, stage }),
  );
  return { approvalDigest, commit, diffSha256, schemaVersion: 1, stage };
}

export function renderDeploymentApproval(approval) {
  return [
    "# Production Deployment Approval",
    "",
    `Commit: \`${approval.commit}\``,
    "",
    `CDK diff SHA-256: \`${approval.diffSha256}\``,
    "",
    `Approval digest: \`${approval.approvalDigest}\``,
    "",
    "A deploy run must recompute this exact digest against unchanged AWS state.",
    "",
  ].join("\n");
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const rawDiff = await readFile(args.diff, "utf8");
  const approval = createDeploymentApproval({
    commit: args.commit,
    rawDiff,
    stage: args.stage,
  });
  const markdown = renderDeploymentApproval(approval);
  await writeFile(
    args.output,
    `${JSON.stringify(approval, undefined, 2)}\n`,
    "utf8",
  );
  if (args.githubOutput !== undefined) {
    await appendFile(
      args.githubOutput,
      `approval_digest=${approval.approvalDigest}\n`,
      "utf8",
    );
  }
  process.stdout.write(markdown);
  if (
    args.expectedDigest !== undefined &&
    args.expectedDigest !== approval.approvalDigest
  ) {
    process.stderr.write(
      "Approved production plan does not match this commit and current AWS diff.\n",
    );
    process.exitCode = 2;
  }
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--commit") {
      values.commit = value;
    } else if (name === "--diff") {
      values.diff = value;
    } else if (name === "--expected-digest") {
      values.expectedDigest = value;
    } else if (name === "--github-output") {
      values.githubOutput = value;
    } else if (name === "--output") {
      values.output = value;
    } else if (name === "--stage") {
      values.stage = value;
    } else {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  for (const key of ["commit", "diff", "output", "stage"]) {
    if (values[key] === undefined) {
      throw new Error(`--${key} is required`);
    }
  }
  if (
    values.expectedDigest !== undefined &&
    !/^[a-f0-9]{64}$/u.test(values.expectedDigest)
  ) {
    throw new Error("--expected-digest must be a lowercase SHA-256 digest");
  }
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
