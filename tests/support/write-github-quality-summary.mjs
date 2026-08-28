import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const summaryPath = path.join(repositoryRoot, "allure-report", "summary.json");

const markdown = await createSummaryMarkdown();
const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;

if (githubStepSummary === undefined || githubStepSummary.trim().length === 0) {
  console.log(markdown);
} else {
  await appendFile(githubStepSummary, markdown);
}

async function createSummaryMarkdown() {
  const runUrl = createRunUrl();
  const artifactUrl = process.env.CPI_QUALITY_ARTIFACT_URL ?? "";
  const diagnosticLink =
    artifactUrl.trim().length > 0
      ? `[quality diagnostics artifact](${artifactUrl})`
      : runUrl === undefined
        ? "the quality diagnostics artifact"
        : `[the workflow run artifacts section](${runUrl})`;

  let reportSummary;
  try {
    reportSummary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch (error) {
    return [
      "## Quality Report",
      "",
      "Allure report summary was not generated.",
      "",
      `Download ${diagnosticLink} to inspect available raw results, Playwright traces, screenshots, and logs.`,
      "",
    ].join("\n");
  }

  const stats = reportSummary.stats ?? {};
  const total = readCount(stats.total);
  const passed = readCount(stats.passed);
  const failed = readCount(stats.failed);
  const broken = readCount(stats.broken);
  const skipped = readCount(stats.skipped);
  const unknown = Math.max(
    0,
    total - passed - failed - broken - skipped,
  );
  const retries = readCount(stats.retries);
  const duration = formatDuration(readCount(reportSummary.duration));
  const status = String(reportSummary.status ?? "unknown");

  return [
    "## Quality Report",
    "",
    `Allure status: **${status}**`,
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Total | ${total} |`,
    `| Passed | ${passed} |`,
    `| Failed | ${failed} |`,
    `| Broken | ${broken} |`,
    `| Skipped | ${skipped} |`,
    `| Unknown | ${unknown} |`,
    `| Retries | ${retries} |`,
    "",
    `Duration: ${duration}`,
    "",
    `Download ${diagnosticLink} to open the full Allure HTML report, Playwright HTML report, traces, screenshots, and raw result files.`,
    "",
    "Artifact privacy boundary: do not publish this diagnostic bundle publicly until screenshots, traces, cookies, request payloads, and response bodies have been reviewed.",
    "",
  ].join("\n");
}

function readCount(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function formatDuration(durationMs) {
  if (durationMs === 0) {
    return "0ms";
  }

  const seconds = durationMs / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function createRunUrl() {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  if (
    serverUrl === undefined ||
    repository === undefined ||
    runId === undefined
  ) {
    return undefined;
  }

  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}
