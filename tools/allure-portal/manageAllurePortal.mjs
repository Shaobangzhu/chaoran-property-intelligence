import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildAllurePortal } from "./portal.mjs";

async function main() {
  const [operation, ...argv] = process.argv.slice(2);
  const args = readArguments(argv);

  if (operation === "build") {
    requireArguments(args, [
      "generated-at",
      "report",
      "repository",
      "run-attempt",
      "run-id",
      "server-url",
      "site",
      "source-sha",
      "status",
      "workflow",
    ]);
    const result = await buildAllurePortal({
      generatedAt: args["generated-at"],
      maxFileBytes: readPositiveInteger(
        args["max-file-bytes"] ?? "25000000",
        "max-file-bytes",
      ),
      maxFiles: readPositiveInteger(args["max-files"] ?? "19000", "max-files"),
      reportDirectory: args.report,
      repository: args.repository,
      retentionDays: readPositiveInteger(
        args["retention-days"] ?? "30",
        "retention-days",
      ),
      runAttempt: readPositiveInteger(args["run-attempt"], "run-attempt"),
      runId: args["run-id"],
      serverUrl: args["server-url"],
      siteDirectory: args.site,
      sourceSha: args["source-sha"],
      status: args.status,
      timeZone: args.timezone ?? "America/Los_Angeles",
      workflow: args.workflow,
    });
    process.stdout.write(
      `Prepared ${result.reportCount} retained report(s) across ${result.fileCount} files.\n`,
    );
    await writeOutputs(args["github-output"], result);
    return;
  }

  throw new Error("Operation must be build");
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
  return values;
}

function requireArguments(values, names) {
  for (const name of names) {
    if (values[name] === undefined) {
      throw new Error(`--${name} is required`);
    }
  }
}

function readPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

async function writeOutputs(target, result) {
  if (target === undefined) {
    return;
  }
  await appendFile(
    target,
    [
      `current_report_published=${result.currentReportPublished}`,
      `file_count=${result.fileCount}`,
      `latest_directory=${result.latestDirectory ?? ""}`,
      `report_count=${result.reportCount}`,
      `report_directory=${result.reportDirectory ?? ""}`,
      "",
    ].join("\n"),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
