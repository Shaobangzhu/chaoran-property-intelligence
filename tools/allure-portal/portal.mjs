import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const METADATA_FILE = "report-metadata.json";
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export async function buildAllurePortal({
  generatedAt,
  maxFileBytes = 25_000_000,
  maxFiles = 19_000,
  reportDirectory,
  repository,
  retentionDays = 30,
  runAttempt,
  runId,
  serverUrl = "https://github.com",
  siteDirectory,
  sourceSha,
  status,
  timeZone = DEFAULT_TIME_ZONE,
  workflow,
}) {
  const run = validateRunMetadata({
    generatedAt,
    repository,
    runAttempt,
    runId,
    serverUrl,
    sourceSha,
    status,
    timeZone,
    workflow,
  });
  validatePositiveInteger("retentionDays", retentionDays);
  validatePositiveInteger("maxFileBytes", maxFileBytes);
  validatePositiveInteger("maxFiles", maxFiles);

  const runsDirectory = path.join(siteDirectory, "runs");
  await mkdir(runsDirectory, { recursive: true });

  let reports = await loadReports(runsDirectory);
  const cutoffDate = subtractCalendarDays(
    run.reportDate,
    retentionDays - 1,
  );

  for (const report of reports) {
    if (report.reportDate < cutoffDate) {
      await rm(path.join(runsDirectory, report.directory), {
        force: true,
        recursive: true,
      });
    }
  }
  reports = reports.filter((report) => report.reportDate >= cutoffDate);

  const hasCurrentReport = await hasReportIndex(reportDirectory);
  if (hasCurrentReport) {
    for (const report of reports) {
      if (report.reportDate === run.reportDate) {
        await rm(path.join(runsDirectory, report.directory), {
          force: true,
          recursive: true,
        });
      }
    }
    reports = reports.filter(
      (report) => report.reportDate !== run.reportDate,
    );

    const directory = `${run.reportDate}-${run.runId}`;
    const target = path.join(runsDirectory, directory);
    await rm(target, { force: true, recursive: true });
    await cp(reportDirectory, target, { recursive: true });

    const summary = await readAllureSummary(reportDirectory);
    const metadata = { ...run, directory, schemaVersion: 1, summary };
    await writeJson(path.join(target, METADATA_FILE), metadata);
    reports.push(metadata);
  }

  reports = await keepNewestReportPerDay({ reports, runsDirectory });
  reports.sort(compareReportsNewestFirst);

  await rebuildLatest({ reports, runsDirectory, siteDirectory });
  await writeJson(path.join(siteDirectory, "reports.json"), {
    generatedAt: run.generatedAt,
    reports,
    retentionDays,
    schemaVersion: 1,
    timeZone,
  });
  await writeFile(
    path.join(siteDirectory, "index.html"),
    renderPortalIndex({ reports, retentionDays, timeZone }),
    "utf8",
  );
  await writeFile(
    path.join(siteDirectory, "robots.txt"),
    "User-agent: *\nDisallow: /\n",
    "utf8",
  );
  await writeFile(
    path.join(siteDirectory, "_headers"),
    [
      "/*",
      "  Cache-Control: no-store",
      "  Referrer-Policy: no-referrer",
      "  X-Content-Type-Options: nosniff",
      "  X-Frame-Options: DENY",
      "  X-Robots-Tag: noindex, nofollow",
      "",
    ].join("\n"),
    "utf8",
  );

  const siteStats = await readSiteStats(siteDirectory);
  if (siteStats.fileCount > maxFiles) {
    throw new Error(
      `Portal contains ${siteStats.fileCount} files, exceeding the configured ${maxFiles}-file safety limit`,
    );
  }
  if (siteStats.largestFileBytes > maxFileBytes) {
    throw new Error(
      `Portal contains a ${siteStats.largestFileBytes}-byte file, exceeding the configured ${maxFileBytes}-byte safety limit`,
    );
  }

  return {
    currentReportPublished: hasCurrentReport,
    fileCount: siteStats.fileCount,
    latestDirectory: reports[0]?.directory,
    reportCount: reports.length,
    reportDirectory: hasCurrentReport
      ? `${run.reportDate}-${run.runId}`
      : undefined,
  };
}

async function loadReports(runsDirectory) {
  const entries = await readdir(runsDirectory, { withFileTypes: true });
  const reports = [];

  for (const entry of entries) {
    const target = path.join(runsDirectory, entry.name);
    if (!entry.isDirectory()) {
      await rm(target, { force: true, recursive: true });
      continue;
    }

    try {
      const metadata = JSON.parse(
        await readFile(path.join(target, METADATA_FILE), "utf8"),
      );
      if (!isStoredReport(metadata, entry.name)) {
        throw new Error("invalid report metadata");
      }
      if (!(await hasReportIndex(target))) {
        throw new Error("missing report index");
      }
      reports.push(metadata);
    } catch {
      await rm(target, { force: true, recursive: true });
    }
  }

  return reports;
}

async function keepNewestReportPerDay({ reports, runsDirectory }) {
  const newestByDay = new Map();
  const ordered = [...reports].sort(compareReportsNewestFirst);

  for (const report of ordered) {
    if (newestByDay.has(report.reportDate)) {
      await rm(path.join(runsDirectory, report.directory), {
        force: true,
        recursive: true,
      });
    } else {
      newestByDay.set(report.reportDate, report);
    }
  }

  return [...newestByDay.values()];
}

async function rebuildLatest({ reports, runsDirectory, siteDirectory }) {
  const latest = path.join(siteDirectory, "latest");
  await rm(latest, { force: true, recursive: true });
  if (reports.length > 0) {
    await cp(path.join(runsDirectory, reports[0].directory), latest, {
      recursive: true,
    });
  }
}

function validateRunMetadata({
  generatedAt,
  repository,
  runAttempt,
  runId,
  serverUrl,
  sourceSha,
  status,
  timeZone,
  workflow,
}) {
  if (!/^\d+$/u.test(String(runId))) {
    throw new Error("runId must contain digits only");
  }
  validatePositiveInteger("runAttempt", Number(runAttempt));
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error("sourceSha must be a lowercase 40-character Git SHA");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("repository must use the owner/name format");
  }
  if (typeof workflow !== "string" || workflow.trim().length === 0) {
    throw new Error("workflow is required");
  }
  if (workflow.length > 120) {
    throw new Error("workflow must be at most 120 characters");
  }
  if (!new Set(["cancelled", "failure", "skipped", "success"]).has(status)) {
    throw new Error("status must be a GitHub job conclusion");
  }

  const generatedDate = new Date(generatedAt);
  if (
    Number.isNaN(generatedDate.valueOf()) ||
    generatedDate.toISOString() !== generatedAt
  ) {
    throw new Error("generatedAt must be an ISO-8601 UTC timestamp");
  }

  let reportDate;
  try {
    reportDate = formatDateInTimeZone(generatedDate, timeZone);
  } catch {
    throw new Error("timeZone must be a supported IANA time zone");
  }

  const normalizedServerUrl = new URL(serverUrl);
  if (
    normalizedServerUrl.protocol !== "https:" ||
    normalizedServerUrl.username ||
    normalizedServerUrl.password ||
    normalizedServerUrl.search ||
    normalizedServerUrl.hash
  ) {
    throw new Error("serverUrl must be a credential-free HTTPS URL");
  }
  normalizedServerUrl.pathname = normalizedServerUrl.pathname.replace(/\/$/u, "");

  return {
    generatedAt,
    reportDate,
    repository,
    runAttempt: Number(runAttempt),
    runId: String(runId),
    runUrl: `${normalizedServerUrl.toString().replace(/\/$/u, "")}/${repository}/actions/runs/${runId}`,
    sourceSha,
    status,
    workflow: workflow.trim(),
  };
}

function isStoredReport(value, directory) {
  return (
    value?.schemaVersion === 1 &&
    value.directory === directory &&
    value.directory === `${value.reportDate}-${value.runId}` &&
    /^\d{4}-\d{2}-\d{2}-\d+$/u.test(directory) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.reportDate) &&
    /^\d+$/u.test(value.runId) &&
    Number.isInteger(value.runAttempt) &&
    value.runAttempt > 0 &&
    typeof value.generatedAt === "string" &&
    !Number.isNaN(new Date(value.generatedAt).valueOf()) &&
    /^[a-f0-9]{40}$/u.test(value.sourceSha) &&
    typeof value.workflow === "string" &&
    typeof value.runUrl === "string" &&
    typeof value.status === "string"
  );
}

async function readAllureSummary(reportDirectory) {
  try {
    const summary = JSON.parse(
      await readFile(path.join(reportDirectory, "summary.json"), "utf8"),
    );
    const stats = summary.stats ?? {};
    return {
      broken: readCount(stats.broken),
      failed: readCount(stats.failed),
      passed: readCount(stats.passed),
      skipped: readCount(stats.skipped),
      status: readSummaryStatus(summary.status),
      total: readCount(stats.total),
    };
  } catch {
    return {
      broken: 0,
      failed: 0,
      passed: 0,
      skipped: 0,
      status: "unknown",
      total: 0,
    };
  }
}

function readCount(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function readSummaryStatus(value) {
  return typeof value === "string" && /^[a-z]+$/u.test(value)
    ? value
    : "unknown";
}

function compareReportsNewestFirst(left, right) {
  const timestampComparison = right.generatedAt.localeCompare(left.generatedAt);
  if (timestampComparison !== 0) {
    return timestampComparison;
  }
  return Number(right.runId) - Number(left.runId);
}

function subtractCalendarDays(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderPortalIndex({ reports, retentionDays, timeZone }) {
  const reportCards = reports.length === 0
    ? '<p class="empty">No retained test reports are currently available.</p>'
    : reports.map(renderReportCard).join("\n");
  const latestLink = reports.length === 0
    ? '<span class="latest-disabled">No latest report</span>'
    : '<a class="latest" href="./latest/">Open latest report</a>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>CPI Test Reports</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f6f7; color: #17212b; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      header { background: #fff; border-bottom: 1px solid #d8dee4; }
      .bar, main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; }
      .bar { min-height: 72px; display: flex; align-items: center; gap: 14px; }
      .mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 9px; background: #087c7a; color: #fff; font-size: 13px; font-weight: 800; letter-spacing: .06em; }
      .brand { font-weight: 750; font-size: 18px; }
      main { padding: 54px 0 72px; }
      .eyebrow { color: #ad4d25; font-weight: 800; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 10px 0 8px; font-size: clamp(32px, 5vw, 48px); letter-spacing: -.035em; }
      .intro { margin: 0; max-width: 720px; color: #62707d; font-size: 17px; line-height: 1.55; }
      .actions { margin: 28px 0 42px; }
      .latest, .latest-disabled { display: inline-flex; min-height: 46px; align-items: center; border-radius: 8px; padding: 0 18px; font-weight: 750; }
      .latest { background: #087c7a; color: #fff; text-decoration: none; }
      .latest:hover { background: #066967; }
      .latest-disabled { background: #e7ebee; color: #6d7882; }
      .section-title { margin: 0 0 14px; font-size: 20px; }
      .reports { display: grid; gap: 12px; }
      .report { display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 18px; padding: 18px 20px; border: 1px solid #d7dee3; border-radius: 10px; background: #fff; color: inherit; text-decoration: none; }
      .report:hover { border-color: #88aaa8; box-shadow: 0 4px 16px rgba(20, 38, 48, .07); }
      .date { font-weight: 800; }
      .meta { color: #667582; font-size: 14px; line-height: 1.45; }
      .counts { margin-top: 3px; color: #34424e; }
      .status { justify-self: end; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .status-success, .status-passed { background: #e1f4ec; color: #17684e; }
      .status-failure, .status-failed, .status-broken { background: #fce7e4; color: #8d302a; }
      .status-cancelled, .status-skipped, .status-unknown { background: #edf0f2; color: #596772; }
      .empty { padding: 24px; border: 1px dashed #bdc6cc; border-radius: 10px; color: #667582; background: #fff; }
      footer { margin-top: 36px; color: #77838d; font-size: 13px; }
      @media (max-width: 680px) { .report { grid-template-columns: 1fr auto; } .date { grid-column: 1; } .meta { grid-column: 1 / -1; grid-row: 2; } .status { grid-column: 2; grid-row: 1; } }
    </style>
  </head>
  <body>
    <header><div class="bar"><span class="mark">CPI</span><span class="brand">Chaoran Property Intelligence</span></div></header>
    <main>
      <div class="eyebrow">Quality observability</div>
      <h1>Test Reports</h1>
      <p class="intro">One protected Allure report is retained per calendar day for the latest ${retentionDays} days. Dates use ${escapeHtml(timeZone)}.</p>
      <div class="actions">${latestLink}</div>
      <h2 class="section-title">Retained daily reports</h2>
      <div class="reports">${reportCards}</div>
      <footer>Access is restricted by Cloudflare Access. Raw diagnostics remain in GitHub Actions artifacts.</footer>
    </main>
  </body>
</html>
`;
}

function renderReportCard(report) {
  const summary = report.summary ?? {};
  const visibleStatus = summary.status === "unknown"
    ? report.status
    : summary.status;
  const statusClass = /^[a-z]+$/u.test(visibleStatus)
    ? visibleStatus
    : "unknown";
  const reportPath = encodeURIComponent(report.directory);
  return `<a class="report" href="./runs/${reportPath}/">
  <span class="date">${escapeHtml(report.reportDate)}</span>
  <span class="meta">${escapeHtml(report.workflow)} · run ${escapeHtml(report.runId)} · attempt ${report.runAttempt}<span class="counts">Total ${readCount(summary.total)} · Passed ${readCount(summary.passed)} · Failed ${readCount(summary.failed)} · Broken ${readCount(summary.broken)}</span></span>
  <span class="status status-${statusClass}">${escapeHtml(visibleStatus)}</span>
</a>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readSiteStats(directory) {
  let fileCount = 0;
  let largestFileBytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const details = await lstat(target);
    if (details.isSymbolicLink()) {
      throw new Error(`Portal must not contain symbolic links: ${target}`);
    }
    if (details.isDirectory()) {
      const nested = await readSiteStats(target);
      fileCount += nested.fileCount;
      largestFileBytes = Math.max(largestFileBytes, nested.largestFileBytes);
    } else if (details.isFile()) {
      fileCount += 1;
      largestFileBytes = Math.max(largestFileBytes, details.size);
    }
  }
  return { fileCount, largestFileBytes };
}

async function hasReportIndex(directory) {
  if (!(await isDirectory(directory))) {
    return false;
  }
  try {
    return (await stat(path.join(directory, "index.html"))).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

function validatePositiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
