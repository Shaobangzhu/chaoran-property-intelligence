import type {
  ListingRetentionAggregateCounts,
  ListingRetentionReport,
} from "@chaoran-property-intelligence/application";

import type { TextWriter } from "./runAlertWorker.js";
import {
  runListingRetention,
  type ListingRetentionRequest,
  type ListingRetentionRuntime,
} from "./runListingRetention.js";

const usage = [
  "Usage:",
  "  pnpm listing-retention:preview",
  "  pnpm listing-retention:execute -- --as-of=<ISO timestamp> --expected-search-runs=<count> --expected-search-memberships=<count> --expected-provider-listings=<count> --expected-alert-events=<count>",
  "",
].join("\n");

export interface ListingRetentionCommandRuntime extends ListingRetentionRuntime {
  readonly args: string[];
  readonly stderr: TextWriter;
  readonly stdout: TextWriter;
}

export interface ListingRetentionCommandDependencies {
  run(
    request: ListingRetentionRequest,
    runtime: ListingRetentionRuntime,
  ): Promise<ListingRetentionReport>;
}

const defaultDependencies: ListingRetentionCommandDependencies = {
  run: runListingRetention,
};

export async function runListingRetentionCommand(
  runtime: ListingRetentionCommandRuntime,
  dependencies: ListingRetentionCommandDependencies = defaultDependencies,
): Promise<number> {
  const request = parseRequest(runtime.args);
  if (request === null) {
    runtime.stderr.write(usage);
    return 1;
  }

  try {
    const report = await dependencies.run(request, runtime);
    writeReport(runtime.stdout, report);
    return 0;
  } catch {
    // Database and environment errors can contain credentials or row data.
    // Keep this boundary intentionally generic; detailed diagnosis stays in
    // database-side operational telemetry.
    runtime.stderr.write("Listing retention failed. No candidate identities were emitted.\n");
    return 1;
  }
}

function parseRequest(args: readonly string[]): ListingRetentionRequest | null {
  if (args.length === 1 && args[0] === "--preview") {
    return { mode: "preview" };
  }
  if (
    args.length === 2 &&
    args[0] === "--preview" &&
    args[1]?.startsWith("--as-of=")
  ) {
    const asOf = args[1].slice("--as-of=".length);
    return isCanonicalTimestamp(asOf) ? { mode: "preview", asOf } : null;
  }
  if (args[0] !== "--execute" || args.length !== 6) {
    return null;
  }

  const flags = readUniqueFlags(args.slice(1));
  if (flags === null || flags.size !== 5) {
    return null;
  }
  const asOf = flags.get("as-of");
  if (asOf === undefined || !isCanonicalTimestamp(asOf)) {
    return null;
  }
  const searchRuns = readCount(flags, "expected-search-runs");
  const searchMemberships = readCount(flags, "expected-search-memberships");
  const providerListings = readCount(flags, "expected-provider-listings");
  const alertEvents = readCount(flags, "expected-alert-events");
  if (
    searchRuns === null ||
    searchMemberships === null ||
    providerListings === null ||
    alertEvents === null
  ) {
    return null;
  }
  const total =
    searchRuns + searchMemberships + providerListings + alertEvents;
  if (!Number.isSafeInteger(total)) {
    return null;
  }

  return {
    mode: "execute",
    asOf,
    expectedCandidates: {
      searchRuns,
      searchMemberships,
      providerListings,
      alertEvents,
      total,
    },
  };
}

function readUniqueFlags(values: readonly string[]): Map<string, string> | null {
  const result = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return null;
    }
    if (result.has(match[1])) {
      return null;
    }
    result.set(match[1], match[2]);
  }
  return result;
}

function readCount(flags: ReadonlyMap<string, string>, key: string): number | null {
  const raw = flags.get(key);
  if (raw === undefined || !/^(0|[1-9]\d*)$/u.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function writeReport(writer: TextWriter, report: ListingRetentionReport): void {
  writer.write(`Listing retention ${report.mode} completed.\n`);
  writer.write(`As of: ${report.asOf}\n`);
  writeCounts(writer, "Candidates", report.candidates);
  writeCounts(writer, "Deleted", report.deleted);
  writer.write(`More eligible rows: ${report.hasMore ? "yes" : "no"}\n`);
}

function writeCounts(
  writer: TextWriter,
  label: string,
  counts: ListingRetentionAggregateCounts,
): void {
  writer.write(`${label} search runs: ${counts.searchRuns}\n`);
  writer.write(`${label} search memberships: ${counts.searchMemberships}\n`);
  writer.write(`${label} provider listings: ${counts.providerListings}\n`);
  writer.write(`${label} alert events: ${counts.alertEvents}\n`);
  writer.write(`${label} total: ${counts.total}\n`);
}
