import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readChangedFilesFromGit } from "./deploymentImpact.mjs";

const applicationExactPaths = new Set([
  ".dockerignore",
  ".env.example",
  ".github/workflows/bootstrap-dev-admin.yml",
  ".github/workflows/bootstrap-production-admin.yml",
  ".github/workflows/deploy-dev.yml",
  ".github/workflows/weekly-dev-regression.yml",
  "Dockerfile",
  "Dockerfile.admin",
  "Dockerfile.api",
  "allurerc.mjs",
  "package.json",
  "playwright.config.ts",
  "tsconfig.playwright.json",
  "vitest.config.mjs",
]);

const platformExactPaths = new Set([
  ".github/workflows/deploy-account-guardrails.yml",
  ".github/workflows/pr-quality-gate.yml",
  ".github/workflows/release-quality-gate.yml",
  "infra/aws/bin/guardrails.ts",
  "infra/aws/lib/accountGuardrailsApplication.ts",
  "infra/aws/lib/accountGuardrailsStack.ts",
  "tools/aws/classifyCdkDiff.mjs",
  "tools/aws/createDeploymentApproval.mjs",
]);

const mixedExactPaths = new Set([
  ".github/workflows/deploy-production.yml",
  "infra/aws/bin/app.ts",
  "infra/aws/cdk.context.json",
  "infra/aws/cdk.json",
  "infra/aws/lib/deploymentEnvironment.ts",
  "infra/aws/lib/deploymentStage.ts",
  "infra/aws/package.json",
  "infra/aws/tsconfig.build.json",
  "infra/aws/tsconfig.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

/**
 * Classify repository changes into independently gated release concerns.
 *
 * Tests and documentation take precedence over their parent directory so a
 * test beside runtime code remains non-deployable. A shared path may appear in
 * both applicationFiles and platformFiles. Unknown paths remain unclassified;
 * callers must reject them instead of assuming that they are safe.
 */
export function classifyReleaseChanges(changedFiles) {
  const files = normalizeChangedFiles(changedFiles);
  const applicationFiles = [];
  const platformFiles = [];
  const nonDeployableFiles = [];
  const unclassifiedFiles = [];

  for (const file of files) {
    if (isNonDeployablePath(file)) {
      nonDeployableFiles.push(file);
      continue;
    }

    const application = isApplicationPath(file);
    const platform = isPlatformPath(file);

    if (application) {
      applicationFiles.push(file);
    }
    if (platform) {
      platformFiles.push(file);
    }
    if (!application && !platform) {
      unclassifiedFiles.push(file);
    }
  }

  return {
    applicationRequired: applicationFiles.length > 0,
    platformRequired: platformFiles.length > 0,
    documentationOnly:
      files.length > 0 && nonDeployableFiles.length === files.length,
    applicationFiles,
    platformFiles,
    nonDeployableFiles,
    unclassifiedFiles,
  };
}

export function assertReleaseClassification(classification) {
  const changedFileCount = countChangedFiles(classification);

  if (changedFileCount === 0) {
    throw new Error(
      "Release change classification failed closed because no changed files were detected",
    );
  }

  if (classification.unclassifiedFiles.length > 0) {
    throw new Error(
      "Release change classification failed closed for unclassified files: " +
        classification.unclassifiedFiles.slice(0, 10).join(", "),
    );
  }
}

export function formatReleaseClassificationMarkdown(classification) {
  const changedFileCount = countChangedFiles(classification);
  const valid =
    changedFileCount > 0 && classification.unclassifiedFiles.length === 0;

  return [
    "## Release Change Classification",
    "",
    `Classification valid: ${valid ? "yes" : "no"}`,
    `Application gate required: ${classification.applicationRequired ? "yes" : "no"}`,
    `Platform gate required: ${classification.platformRequired ? "yes" : "no"}`,
    `Documentation/tests-only path: ${classification.documentationOnly ? "yes" : "no"}`,
    `Changed files: ${changedFileCount}`,
    "",
    ...formatFileSection("Application files", classification.applicationFiles),
    "",
    ...formatFileSection("Platform files", classification.platformFiles),
    "",
    ...formatFileSection(
      "Non-deployable documentation/test files",
      classification.nonDeployableFiles,
    ),
    "",
    ...formatFileSection(
      "Unclassified files (fail closed)",
      classification.unclassifiedFiles,
    ),
    "",
  ].join("\n");
}

function isApplicationPath(file) {
  if (mixedExactPaths.has(file) || applicationExactPaths.has(file)) {
    return true;
  }

  if (file.startsWith("apps/") || file.startsWith("packages/")) {
    return true;
  }

  if (file.startsWith("infra/aws/")) {
    return !platformExactPaths.has(file);
  }

  return (
    file.startsWith("tools/wildfire-hazard/") ||
    file.startsWith("tools/aws/createDevAdminBootstrapApproval.") ||
    file.startsWith("tools/aws/createProductionAdminBootstrapApproval.") ||
    file.startsWith("tools/aws/validatePriceEstimationRuntime.")
  );
}

function isPlatformPath(file) {
  return (
    mixedExactPaths.has(file) ||
    platformExactPaths.has(file) ||
    file.startsWith("tools/release/") ||
    file.startsWith("tools/quality-gate/") ||
    file.startsWith("tools/flaky-tests/") ||
    file.startsWith("tools/allure-portal/") ||
    file.startsWith("tools/aws/waitForHttp.")
  );
}

function isNonDeployablePath(file) {
  return (
    file.startsWith("docs/") ||
    file.startsWith("tests/") ||
    file === "README.md" ||
    file === "LICENSE" ||
    file.endsWith(".md") ||
    /(?:^|\/)(?:__snapshots__|fixtures)\//u.test(file) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)test\//u.test(file)
  );
}

function normalizeChangedFiles(changedFiles) {
  return [
    ...new Set(
      changedFiles
        .map((file) => file.trim().replaceAll("\\", "/"))
        .filter((file) => file.length > 0)
        .map((file) => file.replace(/^\.\//u, "")),
    ),
  ].sort();
}

function formatFileSection(title, files) {
  return [
    `### ${title}`,
    "",
    ...(files.length === 0 ? ["- None"] : files.map((file) => `- \`${file}\``)),
  ];
}

function countChangedFiles(classification) {
  return new Set([
    ...classification.applicationFiles,
    ...classification.platformFiles,
    ...classification.nonDeployableFiles,
    ...classification.unclassifiedFiles,
  ]).size;
}

function parseCliArguments(argv) {
  const args = {
    base: undefined,
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
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (args.base === undefined || args.head === undefined) {
    throw new Error("--base and --head are required");
  }

  return args;
}

function writeGithubOutputs(filePath, classification) {
  if (filePath === undefined || filePath.trim().length === 0) {
    return;
  }

  const changedFileCount = countChangedFiles(classification);
  const classificationValid =
    changedFileCount > 0 && classification.unclassifiedFiles.length === 0;

  writeFileSync(
    filePath,
    [
      `application_required=${classification.applicationRequired}`,
      `platform_required=${classification.platformRequired}`,
      `documentation_only=${classification.documentationOnly}`,
      `classification_valid=${classificationValid}`,
      `changed_file_count=${changedFileCount}`,
      `unclassified_file_count=${classification.unclassifiedFiles.length}`,
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
  const classification = classifyReleaseChanges(changedFiles);
  const markdown = formatReleaseClassificationMarkdown(classification);

  writeGithubOutputs(args.githubOutput, classification);
  writeSummary(args.summaryFile, markdown);
  console.log(markdown);
  assertReleaseClassification(classification);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
