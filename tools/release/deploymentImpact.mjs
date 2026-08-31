import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function createDeploymentImpact(
  changedFiles,
  { emptyMeansDeploy = true, forceDeploy = false } = {},
) {
  const files = normalizeChangedFiles(changedFiles);
  const deployableFiles = files.filter((file) => !isNonDeployablePath(file));
  const skippedFiles = files.filter((file) => isNonDeployablePath(file));
  const deployRequired =
    forceDeploy || deployableFiles.length > 0 || (emptyMeansDeploy && files.length === 0);

  return {
    changedFiles: files,
    deployableFiles,
    deployRequired,
    forced: forceDeploy,
    skippedFiles,
  };
}

export function formatDeploymentImpactMarkdown(impact) {
  const reason = impact.forced
    ? "manual dispatch forces a reviewed deployment"
    : impact.deployableFiles.length > 0
      ? "runtime, infrastructure, delivery, or unclassified files changed"
      : impact.changedFiles.length === 0 && impact.deployRequired
        ? "no changed files were detected, so the safe fallback deploys"
        : "all changed files are explicitly non-deployable";

  return [
    "## DEV Deployment Impact",
    "",
    `Deployment required: ${impact.deployRequired ? "yes" : "no"}`,
    `Reason: ${reason}`,
    `Changed files: ${impact.changedFiles.length}`,
    `Deployable or conservative-fallback files: ${impact.deployableFiles.length}`,
    `Non-deployable documentation/test files: ${impact.skippedFiles.length}`,
    "",
    ...formatFileSection("Deployable or conservative-fallback files", impact.deployableFiles),
    "",
    ...formatFileSection("Non-deployable files", impact.skippedFiles),
    "",
  ].join("\n");
}

function isNonDeployablePath(file) {
  return (
    file.startsWith("docs/") ||
    file.startsWith("tests/") ||
    file === "README.md" ||
    file === "LICENSE" ||
    file.endsWith(".md") ||
    /(?:^|\/)__snapshots__\//u.test(file) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)test\//u.test(file)
  );
}

function normalizeChangedFiles(changedFiles) {
  return [...new Set(changedFiles
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter((file) => file.length > 0)
    .map((file) => file.replace(/^\.\//u, "")))]
    .sort();
}

function formatFileSection(title, files) {
  return [
    `### ${title}`,
    "",
    ...(files.length === 0 ? ["- None"] : files.map((file) => `- \`${file}\``)),
  ];
}

export function readChangedFilesFromGit(base, head) {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--no-renames",
      "--name-only",
      "--diff-filter=ACMRDTUXB",
      base,
      head,
    ],
    { encoding: "utf8" },
  );

  return output.split(/\r?\n/u);
}

function parseCliArguments(argv) {
  const args = {
    base: undefined,
    forceDeploy: false,
    githubOutput: process.env.GITHUB_OUTPUT,
    head: undefined,
    summaryFile: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--base" && next !== undefined) {
      args.base = next;
      index += 1;
    } else if (arg === "--head" && next !== undefined) {
      args.head = next;
      index += 1;
    } else if (arg === "--github-output" && next !== undefined) {
      args.githubOutput = next;
      index += 1;
    } else if (arg === "--summary-file" && next !== undefined) {
      args.summaryFile = next;
      index += 1;
    } else if (arg === "--force-deploy") {
      args.forceDeploy = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (args.base === undefined || args.head === undefined) {
    throw new Error("--base and --head are required");
  }

  return args;
}

function writeGithubOutputs(filePath, impact) {
  if (filePath === undefined || filePath.trim().length === 0) {
    return;
  }

  writeFileSync(
    filePath,
    [
      `deploy_required=${impact.deployRequired}`,
      `changed_file_count=${impact.changedFiles.length}`,
      `deployable_file_count=${impact.deployableFiles.length}`,
    ].join("\n") + "\n",
    { flag: "a" },
  );
}

function writeSummary(filePath, markdown) {
  if (filePath === undefined || filePath.trim().length === 0) {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, markdown);
}

function main() {
  const args = parseCliArguments(process.argv.slice(2));
  const changedFiles = readChangedFilesFromGit(args.base, args.head);
  const impact = createDeploymentImpact(changedFiles, {
    forceDeploy: args.forceDeploy,
  });
  const markdown = formatDeploymentImpactMarkdown(impact);

  writeGithubOutputs(args.githubOutput, impact);
  writeSummary(args.summaryFile, markdown);
  console.log(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
