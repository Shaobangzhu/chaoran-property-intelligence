import {
  normalizeListingRetentionCandidate,
  normalizeListingRetentionPolicy,
  normalizeListingRetentionReport,
  type ExecuteListingRetentionInput,
  type InspectListingRetentionInput,
  type ListingRetentionAggregateCounts,
  type ListingRetentionRecordKind,
  type ListingRetentionReport,
  type ListingRetentionRepositoryPort,
} from "./listingRetentionContracts.js";

export interface PreviewListingRetentionOptions {
  readonly repository: ListingRetentionRepositoryPort;
  readonly now: () => Date;
}

export interface ExecuteListingRetentionOptions {
  readonly repository: ListingRetentionRepositoryPort;
}

export class InvalidListingRetentionInputError extends Error {
  constructor() {
    super("Listing retention input was invalid");
    this.name = "InvalidListingRetentionInputError";
  }
}

export class InvalidListingRetentionClockError extends Error {
  constructor() {
    super("Listing retention clock was invalid");
    this.name = "InvalidListingRetentionClockError";
  }
}

export class InvalidListingRetentionResultError extends Error {
  constructor() {
    super("Listing retention result was invalid");
    this.name = "InvalidListingRetentionResultError";
  }
}

export class PreviewListingRetention {
  constructor(private readonly options: PreviewListingRetentionOptions) {}

  async execute(
    input: InspectListingRetentionInput,
  ): Promise<ListingRetentionReport> {
    const normalizedInput = normalizeInspectInput(input);
    const startedAt = readClock(this.options.now);
    if (normalizedInput.asOf > startedAt) {
      throw new InvalidListingRetentionInputError();
    }

    const candidates = await this.options.repository.listCandidates(
      normalizedInput,
    );
    const counts = countCandidates(candidates, normalizedInput);
    const completedAt = readClock(this.options.now);
    if (completedAt < startedAt) {
      throw new InvalidListingRetentionClockError();
    }

    return normalizeListingRetentionReport({
      mode: "preview",
      asOf: normalizedInput.asOf,
      startedAt,
      completedAt,
      candidates: counts,
      deleted: emptyCounts(),
      // A full batch is deliberately reported as possibly having more work.
      // Execute mode performs an exact post-delete check in the transaction.
      hasMore: candidates.length === normalizedInput.policy.batchSize,
    });
  }
}

export class ExecuteListingRetention {
  constructor(private readonly options: ExecuteListingRetentionOptions) {}

  async execute(
    input: ExecuteListingRetentionInput,
  ): Promise<ListingRetentionReport> {
    const normalizedInput = normalizeExecuteInput(input);
    const persisted = await this.options.repository.execute(normalizedInput);
    let report: ListingRetentionReport;
    try {
      report = normalizeListingRetentionReport(persisted);
    } catch {
      throw new InvalidListingRetentionResultError();
    }

    if (
      report.mode !== "execute" ||
      report.asOf !== normalizedInput.asOf ||
      !countsEqual(report.candidates, normalizedInput.expectedCandidates)
    ) {
      throw new InvalidListingRetentionResultError();
    }
    return report;
  }
}

function normalizeInspectInput(
  input: InspectListingRetentionInput,
): InspectListingRetentionInput {
  if (!isCanonicalTimestamp(input.asOf)) {
    throw new InvalidListingRetentionInputError();
  }
  try {
    return Object.freeze({
      asOf: input.asOf,
      policy: normalizeListingRetentionPolicy(input.policy),
    });
  } catch {
    throw new InvalidListingRetentionInputError();
  }
}

function normalizeExecuteInput(
  input: ExecuteListingRetentionInput,
): ExecuteListingRetentionInput {
  const normalized = normalizeInspectInput(input);
  if (!validCounts(input.expectedCandidates)) {
    throw new InvalidListingRetentionInputError();
  }
  return Object.freeze({
    ...normalized,
    expectedCandidates: Object.freeze({ ...input.expectedCandidates }),
  });
}

function countCandidates(
  values: Awaited<
    ReturnType<ListingRetentionRepositoryPort["listCandidates"]>
  >,
  input: InspectListingRetentionInput,
): ListingRetentionAggregateCounts {
  if (values.length > input.policy.batchSize) {
    throw new InvalidListingRetentionResultError();
  }
  const counts = mutableEmptyCounts();
  const identities = new Set<string>();
  for (const value of values) {
    let candidate;
    try {
      candidate = normalizeListingRetentionCandidate(value);
    } catch {
      throw new InvalidListingRetentionResultError();
    }
    if (candidate.retainedThrough > input.asOf) {
      throw new InvalidListingRetentionResultError();
    }
    const identity = `${candidate.recordKind}\u0000${candidate.recordKey}`;
    if (identities.has(identity)) {
      throw new InvalidListingRetentionResultError();
    }
    identities.add(identity);
    increment(counts, candidate.recordKind);
  }
  counts.total =
    counts.searchRuns +
    counts.searchMemberships +
    counts.providerListings +
    counts.alertEvents;
  return Object.freeze(counts);
}

function emptyCounts(): ListingRetentionAggregateCounts {
  return Object.freeze(mutableEmptyCounts());
}

function mutableEmptyCounts(): {
  searchRuns: number;
  searchMemberships: number;
  providerListings: number;
  alertEvents: number;
  total: number;
} {
  return {
    searchRuns: 0,
    searchMemberships: 0,
    providerListings: 0,
    alertEvents: 0,
    total: 0,
  };
}

function increment(
  counts: ReturnType<typeof mutableEmptyCounts>,
  kind: ListingRetentionRecordKind,
): void {
  if (kind === "search-run") counts.searchRuns += 1;
  if (kind === "search-membership") counts.searchMemberships += 1;
  if (kind === "provider-listing") counts.providerListings += 1;
  if (kind === "alert-event") counts.alertEvents += 1;
}

function validCounts(value: ListingRetentionAggregateCounts): boolean {
  const counts = [
    value.searchRuns,
    value.searchMemberships,
    value.providerListings,
    value.alertEvents,
    value.total,
  ];
  return (
    counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.total ===
      value.searchRuns +
        value.searchMemberships +
        value.providerListings +
        value.alertEvents
  );
}

function countsEqual(
  left: ListingRetentionAggregateCounts,
  right: ListingRetentionAggregateCounts,
): boolean {
  return (
    left.searchRuns === right.searchRuns &&
    left.searchMemberships === right.searchMemberships &&
    left.providerListings === right.providerListings &&
    left.alertEvents === right.alertEvents &&
    left.total === right.total
  );
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidListingRetentionClockError();
  }
  return value.toISOString();
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
