import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAllurePortal } from "./portal.mjs";

const temporaryDirectories = [];
const SOURCE_SHA = "a".repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Allure portal", () => {
  it("publishes a dated report, latest alias, metadata, and private headers", async () => {
    const root = await createTemporaryDirectory();
    const report = await createReport(root, "report", {
      passed: 6,
      status: "passed",
      total: 7,
    });
    const site = path.join(root, "site");

    const result = await buildPortal({
      generatedAt: "2026-09-04T18:30:00.000Z",
      report,
      runId: "1234",
      site,
    });

    expect(result).toMatchObject({
      currentReportPublished: true,
      latestDirectory: "2026-09-04-1234",
      reportCount: 1,
      reportDirectory: "2026-09-04-1234",
    });
    await expect(
      readFile(path.join(site, "latest", "index.html"), "utf8"),
    ).resolves.toContain("fixture report");
    await expect(
      readFile(
        path.join(site, "runs", "2026-09-04-1234", "report-metadata.json"),
        "utf8",
      ),
    ).resolves.toContain('"passed": 6');
    await expect(readFile(path.join(site, "_headers"), "utf8")).resolves.toContain(
      "X-Robots-Tag: noindex, nofollow",
    );
    await expect(readFile(path.join(site, "robots.txt"), "utf8")).resolves.toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });

  it("keeps only the newest report per day and prunes outside 30 calendar days", async () => {
    const root = await createTemporaryDirectory();
    const site = path.join(root, "site");

    await buildPortal({
      generatedAt: "2026-08-05T18:00:00.000Z",
      report: await createReport(root, "old", { total: 1 }),
      runId: "100",
      site,
    });
    await buildPortal({
      generatedAt: "2026-09-03T17:00:00.000Z",
      report: await createReport(root, "yesterday", { total: 2 }),
      runId: "200",
      site,
    });
    await buildPortal({
      generatedAt: "2026-09-04T16:00:00.000Z",
      report: await createReport(root, "today-first", { total: 3 }),
      runId: "300",
      site,
    });
    const result = await buildPortal({
      generatedAt: "2026-09-04T20:00:00.000Z",
      report: await createReport(root, "today-latest", { total: 4 }),
      runId: "301",
      site,
    });

    expect(result.reportCount).toBe(2);
    await expect(pathExists(path.join(site, "runs", "2026-08-05-100"))).resolves.toBe(
      false,
    );
    await expect(pathExists(path.join(site, "runs", "2026-09-04-300"))).resolves.toBe(
      false,
    );
    await expect(pathExists(path.join(site, "runs", "2026-09-04-301"))).resolves.toBe(
      true,
    );
    await expect(
      readFile(path.join(site, "latest", "index.html"), "utf8"),
    ).resolves.toContain("today-latest");
  });

  it("performs cleanup without inventing a report when current output is absent", async () => {
    const root = await createTemporaryDirectory();
    const site = path.join(root, "site");
    await buildPortal({
      generatedAt: "2026-09-03T18:00:00.000Z",
      report: await createReport(root, "available", { total: 2 }),
      runId: "200",
      site,
    });

    const result = await buildPortal({
      generatedAt: "2026-09-04T18:00:00.000Z",
      report: path.join(root, "missing-report"),
      runId: "201",
      site,
    });

    expect(result).toMatchObject({
      currentReportPublished: false,
      latestDirectory: "2026-09-03-200",
      reportCount: 1,
      reportDirectory: undefined,
    });
  });

  it("removes restored reports whose metadata does not match the directory", async () => {
    const root = await createTemporaryDirectory();
    const site = path.join(root, "site");
    await buildPortal({
      generatedAt: "2026-09-03T18:00:00.000Z",
      report: await createReport(root, "available", { total: 2 }),
      runId: "200",
      site,
    });
    const metadataPath = path.join(
      site,
      "runs",
      "2026-09-03-200",
      "report-metadata.json",
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, runId: "999" }),
      "utf8",
    );

    const result = await buildPortal({
      generatedAt: "2026-09-04T18:00:00.000Z",
      report: path.join(root, "missing-report"),
      runId: "201",
      site,
    });

    expect(result.reportCount).toBe(0);
    await expect(
      pathExists(path.join(site, "runs", "2026-09-03-200")),
    ).resolves.toBe(false);
  });

  it("escapes workflow metadata rendered into the portal", async () => {
    const root = await createTemporaryDirectory();
    const report = await createReport(root, "report", { total: 1 });
    const site = path.join(root, "site");

    await buildAllurePortal({
      generatedAt: "2026-09-04T18:30:00.000Z",
      maxFiles: 100,
      reportDirectory: report,
      repository: "owner/repository",
      retentionDays: 30,
      runAttempt: 1,
      runId: "1234",
      serverUrl: "https://github.com",
      siteDirectory: site,
      sourceSha: SOURCE_SHA,
      status: "success",
      timeZone: "America/Los_Angeles",
      workflow: '<script>alert("unsafe")</script>',
    });

    const index = await readFile(path.join(site, "index.html"), "utf8");
    expect(index).not.toContain('<script>alert("unsafe")</script>');
    expect(index).toContain("&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;");
  });

  it("fails before deployment when the portal crosses its file safety limit", async () => {
    const root = await createTemporaryDirectory();
    const report = await createReport(root, "report", { total: 1 });

    await expect(
      buildAllurePortal({
        generatedAt: "2026-09-04T18:30:00.000Z",
        maxFiles: 2,
        reportDirectory: report,
        repository: "owner/repository",
        retentionDays: 30,
        runAttempt: 1,
        runId: "1234",
        serverUrl: "https://github.com",
        siteDirectory: path.join(root, "site"),
        sourceSha: SOURCE_SHA,
        status: "success",
        workflow: "Nightly DEV Regression",
      }),
    ).rejects.toThrow("file safety limit");
  });

  it("fails before deployment when any asset crosses its byte safety limit", async () => {
    const root = await createTemporaryDirectory();
    const report = await createReport(root, "report", { total: 1 });

    await expect(
      buildAllurePortal({
        generatedAt: "2026-09-04T18:30:00.000Z",
        maxFileBytes: 10,
        maxFiles: 100,
        reportDirectory: report,
        repository: "owner/repository",
        retentionDays: 30,
        runAttempt: 1,
        runId: "1234",
        serverUrl: "https://github.com",
        siteDirectory: path.join(root, "site"),
        sourceSha: SOURCE_SHA,
        status: "success",
        workflow: "Nightly DEV Regression",
      }),
    ).rejects.toThrow("byte safety limit");
  });
});

async function buildPortal({ generatedAt, report, runId, site }) {
  return buildAllurePortal({
    generatedAt,
    maxFiles: 500,
    reportDirectory: report,
    repository: "owner/repository",
    retentionDays: 30,
    runAttempt: 1,
    runId,
    serverUrl: "https://github.com",
    siteDirectory: site,
    sourceSha: SOURCE_SHA,
    status: "success",
    timeZone: "America/Los_Angeles",
    workflow: "Nightly DEV Regression",
  });
}

async function createReport(root, name, stats) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), `<h1>${name} fixture report</h1>`, "utf8");
  await writeFile(
    path.join(directory, "summary.json"),
    JSON.stringify({ stats, status: stats.status ?? "passed" }),
    "utf8",
  );
  return directory;
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpi-allure-portal-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
