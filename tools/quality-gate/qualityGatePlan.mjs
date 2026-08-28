import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const suiteNames = [
  "frontend",
  "backend",
  "integration",
  "infra",
  "system",
  "typecheckBuild",
  "full",
];

export function createQualityGatePlan(changedFiles) {
  const files = normalizeChangedFiles(changedFiles);
  const plan = {
    backend: false,
    docsOnly: files.length > 0,
    frontend: false,
    full: false,
    infra: false,
    integration: false,
    reasons: [],
    system: false,
    typecheckBuild: false,
  };

  for (const file of files) {
    applyFileImpact(plan, file);
  }

  if (files.length === 0) {
    markFull(plan, "No changed files were detected, so the safe fallback runs.");
  }

  if (plan.full) {
    plan.frontend = true;
    plan.backend = true;
    plan.integration = true;
    plan.infra = true;
    plan.system = true;
    plan.typecheckBuild = true;
  }

  if (
    plan.frontend ||
    plan.backend ||
    plan.integration ||
    plan.infra ||
    plan.system ||
    plan.typecheckBuild ||
    plan.full
  ) {
    plan.docsOnly = false;
  }

  plan.reasons = [...new Set(plan.reasons)];
  return plan;
}

export function formatPlanMarkdown(plan, changedFiles) {
  const files = normalizeChangedFiles(changedFiles);
  const selectedSuites = suiteNames.filter((name) => plan[name]);

  return [
    "## PR Quality Gate Plan",
    "",
    `Changed files: ${files.length}`,
    `Docs-only: ${plan.docsOnly ? "yes" : "no"}`,
    `Selected suites: ${selectedSuites.length === 0 ? "none" : selectedSuites.join(", ")}`,
    "",
    "| Suite | Run |",
    "| --- | --- |",
    ...suiteNames.map((name) => `| ${name} | ${plan[name] ? "yes" : "no"} |`),
    "",
    "Reasons:",
    ...formatReasons(plan.reasons),
    "",
  ].join("\n");
}

function applyFileImpact(plan, file) {
  if (isDocsOnlyPath(file)) {
    plan.reasons.push(`${file}: documentation-only path`);
    return;
  }

  if (isFullFallbackPath(file)) {
    markFull(plan, `${file}: broad-impact configuration, workflow, or dependency change`);
    return;
  }

  if (file.startsWith("apps/web/")) {
    mark(plan, ["frontend", "system", "typecheckBuild"], `${file}: web application change`);
    return;
  }

  if (file.startsWith("apps/api/")) {
    mark(plan, ["backend", "integration", "system", "typecheckBuild"], `${file}: API contract or runtime change`);
    return;
  }

  if (file.startsWith("apps/alert-worker/")) {
    mark(plan, ["backend", "integration", "typecheckBuild"], `${file}: worker runtime change`);
    return;
  }

  if (file.startsWith("apps/admin-cli/")) {
    mark(plan, ["backend", "integration", "typecheckBuild"], `${file}: admin CLI runtime change`);
    return;
  }

  if (file.startsWith("packages/domain/")) {
    markFull(plan, `${file}: shared domain model change`);
    return;
  }

  if (file.startsWith("packages/application/")) {
    mark(plan, ["frontend", "backend", "integration", "system", "typecheckBuild"], `${file}: shared application use-case change`);
    return;
  }

  if (file.startsWith("packages/auth/")) {
    mark(plan, ["backend", "integration", "system", "typecheckBuild"], `${file}: shared authentication change`);
    return;
  }

  if (file.startsWith("packages/postgres/")) {
    mark(plan, ["backend", "integration", "infra", "typecheckBuild"], `${file}: persistence boundary change`);
    return;
  }

  if (file.startsWith("packages/s3/")) {
    mark(plan, ["backend", "integration", "infra", "typecheckBuild"], `${file}: artifact storage boundary change`);
    return;
  }

  if (file.startsWith("packages/")) {
    mark(plan, ["backend", "integration", "typecheckBuild"], `${file}: shared package change`);
    return;
  }

  if (file.startsWith("infra/aws/")) {
    mark(plan, ["backend", "integration", "infra", "typecheckBuild"], `${file}: infrastructure change`);
    return;
  }

  if (file.startsWith("tools/wildfire-hazard/")) {
    mark(plan, ["frontend", "backend", "typecheckBuild"], `${file}: wildfire data tooling change`);
    return;
  }

  markFull(plan, `${file}: unclassified path uses safe fallback`);
}

function isDocsOnlyPath(file) {
  return (
    file.startsWith("docs/") ||
    file === "README.md" ||
    file.endsWith(".md")
  );
}

function isFullFallbackPath(file) {
  return (
    file === "Dockerfile" ||
    file === "package.json" ||
    file === "pnpm-lock.yaml" ||
    file === "pnpm-workspace.yaml" ||
    file === "playwright.config.ts" ||
    file === "vitest.config.mjs" ||
    file === "tsconfig.base.json" ||
    file === "tsconfig.playwright.json" ||
    file.startsWith(".github/workflows/") ||
    /^tsconfig(?:\..*)?\.json$/u.test(file)
  );
}

function mark(plan, suites, reason) {
  for (const suite of suites) {
    plan[suite] = true;
  }
  plan.reasons.push(reason);
}

function markFull(plan, reason) {
  plan.full = true;
  plan.reasons.push(reason);
}

function normalizeChangedFiles(changedFiles) {
  return changedFiles
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter((file) => file.length > 0)
    .map((file) => file.replace(/^\.\//u, ""))
    .sort();
}

function formatReasons(reasons) {
  if (reasons.length === 0) {
    return ["- No changed files were provided."];
  }

  return reasons.map((reason) => `- ${reason}`);
}

function readChangedFilesFromGit(base, head) {
  const output = execFileSync("git", ["diff", "--name-only", base, head], {
    encoding: "utf8",
  });

  return output.split(/\r?\n/u);
}

function parseCliArguments(argv) {
  const args = {
    base: undefined,
    changedFiles: undefined,
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
    } else if (arg === "--files") {
      args.changedFiles = argv.slice(index + 1);
      break;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return args;
}

function writeGithubOutputs(filePath, plan) {
  if (filePath === undefined || filePath.trim().length === 0) {
    return;
  }

  const lines = [
    `frontend=${plan.frontend}`,
    `backend=${plan.backend}`,
    `integration=${plan.integration}`,
    `infra=${plan.infra}`,
    `system=${plan.system}`,
    `typecheck_build=${plan.typecheckBuild}`,
    `full=${plan.full}`,
    `docs_only=${plan.docsOnly}`,
  ];

  writeFileSync(filePath, `${lines.join("\n")}\n`, { flag: "a" });
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
  const changedFiles =
    args.changedFiles ??
    (args.base !== undefined && args.head !== undefined
      ? readChangedFilesFromGit(args.base, args.head)
      : []);
  const plan = createQualityGatePlan(changedFiles);
  const markdown = formatPlanMarkdown(plan, changedFiles);

  writeGithubOutputs(args.githubOutput, plan);
  writeSummary(args.summaryFile, markdown);
  console.log(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
