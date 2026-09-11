import {
  normalizeListingRetentionCandidate,
  normalizeListingRetentionPolicy,
  normalizeListingRetentionReport,
  type ExecuteListingRetentionInput,
  type InspectListingRetentionInput,
  type ListingRetentionAggregateCounts,
  type ListingRetentionCandidate,
  type ListingRetentionRecordKind,
  type ListingRetentionReport,
  type ListingRetentionRepositoryPort,
} from "@chaoran-property-intelligence/application";

import { readRecord, readString } from "./listingRow.js";
import { readTimestamp } from "./listingRefreshRunRow.js";
import type { SqlConnection, SqlDatabase } from "./sqlDatabase.js";

export class PostgresListingRetentionRepository
  implements ListingRetentionRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async listCandidates(
    input: InspectListingRetentionInput,
  ): Promise<readonly ListingRetentionCandidate[]> {
    const normalized = normalizeInput(input);
    return listCandidates(this.database, normalized);
  }

  async execute(
    input: ExecuteListingRetentionInput,
  ): Promise<ListingRetentionReport> {
    const normalized = normalizeExecuteInput(input);
    const startedAt = reportTimestamp(normalized.asOf);
    return this.database.transaction(async (connection) => {
      const candidates = await listCandidates(connection, normalized);
      const candidateCounts = countCandidates(candidates);
      if (!countsEqual(candidateCounts, normalized.expectedCandidates)) {
        throw new Error(
          "Listing retention candidates changed after the approved preview",
        );
      }

      const deleted = emptyCounts();
      for (const kind of [
        "search-membership",
        "alert-event",
        "search-run",
        "provider-listing",
      ] as const) {
        const keys = candidates
          .filter((candidate) => candidate.recordKind === kind)
          .map((candidate) => candidate.recordKey);
        if (keys.length === 0) {
          continue;
        }
        const deletedCount = await deleteCandidates(connection, kind, keys);
        addDeletedCount(deleted, kind, deletedCount);
      }
      deleted.total =
        deleted.searchRuns +
        deleted.searchMemberships +
        deleted.providerListings +
        deleted.alertEvents;

      const remaining = await listCandidates(connection, normalized, 1);
      return normalizeListingRetentionReport({
        mode: "execute",
        asOf: normalized.asOf,
        startedAt,
        completedAt: reportTimestamp(startedAt),
        candidates: candidateCounts,
        deleted,
        hasMore: remaining.length > 0,
      });
    });
  }
}

async function listCandidates(
  connection: SqlConnection,
  input: InspectListingRetentionInput,
  limit = input.policy.batchSize,
): Promise<readonly ListingRetentionCandidate[]> {
  const result = await connection.query(
    `WITH candidates AS (
       SELECT
         'search-run'::text AS record_kind,
         r.run_id::text AS record_key,
         r.completed_at + make_interval(days => $2::integer) AS retained_through
       FROM listing_search_runs r
       WHERE r.status IN ('succeeded', 'failed', 'superseded')
         AND r.completed_at + make_interval(days => $2::integer) <= $1
         AND NOT EXISTS (
           SELECT 1 FROM listing_search_memberships m
           WHERE m.last_successful_run_id = r.run_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM listing_search_runs child
           WHERE child.superseded_by_run_id = r.run_id
         )
       UNION ALL
       SELECT
         'search-membership'::text,
         m.profile_key || '/' || m.listing_id::text,
         m.lifecycle_changed_at + make_interval(days => CASE
           WHEN m.lifecycle_state = 'inactive' THEN $3::integer
           ELSE $4::integer
         END)
       FROM listing_search_memberships m
       WHERE m.lifecycle_state IN ('inactive', 'out_of_scope')
         AND m.lifecycle_changed_at + make_interval(days => CASE
           WHEN m.lifecycle_state = 'inactive' THEN $3::integer
           ELSE $4::integer
         END) <= $1
       UNION ALL
       SELECT
         'provider-listing'::text,
         l.id::text,
         l.updated_at + make_interval(days => $5::integer)
       FROM listings l
       WHERE l.source = 'rentcast'
         AND l.updated_at + make_interval(days => $5::integer) <= $1
         AND NOT EXISTS (
           SELECT 1 FROM listing_search_memberships m WHERE m.listing_id = l.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM listing_price_observations o
           WHERE o.listing_key = l.deduplication_key
         )
         AND NOT EXISTS (
           SELECT 1 FROM listing_alert_events e
           WHERE e.listing_key = l.deduplication_key
         )
         AND NOT EXISTS (
           SELECT 1 FROM current_showing_list_draft d
           WHERE (d.generation_input -> 'listingIds') ? l.id::text
         )
       UNION ALL
       SELECT
         'alert-event'::text,
         e.id::text,
         e.observed_at + make_interval(days => $6::integer)
       FROM listing_alert_events e
       WHERE e.status = 'sent'
         AND e.observed_at + make_interval(days => $6::integer) <= $1
     )
     SELECT record_kind, record_key, retained_through
     FROM candidates
     ORDER BY retained_through ASC, record_kind ASC, record_key ASC
     LIMIT $7`,
    [
      input.asOf,
      input.policy.runDetailDays,
      input.policy.inactiveMembershipDays,
      input.policy.outOfScopeMembershipDays,
      input.policy.unreferencedProviderListingDays,
      input.policy.alertEventDays,
      limit,
    ],
  );
  return Object.freeze(
    result.rows.map((value) => {
      const row = readRecord(value);
      return normalizeListingRetentionCandidate({
        recordKind: readString(row, "record_kind"),
        recordKey: readString(row, "record_key"),
        retainedThrough: readTimestamp(row.retained_through),
      });
    }),
  );
}

async function deleteCandidates(
  connection: SqlConnection,
  kind: ListingRetentionRecordKind,
  keys: readonly string[],
): Promise<number> {
  switch (kind) {
    case "search-membership": {
      const listingIds = keys.map(parseMembershipKey);
      const result = await connection.query(
        `DELETE FROM listing_search_memberships
         WHERE profile_key = 'primary' AND listing_id = ANY($1::uuid[])
         RETURNING listing_id`,
        [listingIds],
      );
      return result.rows.length;
    }
    case "alert-event": {
      const result = await connection.query(
        `DELETE FROM listing_alert_events
         WHERE id = ANY($1::uuid[]) AND status = 'sent'
         RETURNING id`,
        [keys],
      );
      return result.rows.length;
    }
    case "search-run": {
      const result = await connection.query(
        `DELETE FROM listing_search_runs
         WHERE run_id = ANY($1::uuid[])
           AND status IN ('succeeded', 'failed', 'superseded')
         RETURNING run_id`,
        [keys],
      );
      return result.rows.length;
    }
    case "provider-listing": {
      const result = await connection.query(
        `DELETE FROM listings l
         WHERE l.id = ANY($1::uuid[])
           AND l.source = 'rentcast'
           AND NOT EXISTS (
             SELECT 1 FROM listing_search_memberships m WHERE m.listing_id = l.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM listing_price_observations o
             WHERE o.listing_key = l.deduplication_key
           )
           AND NOT EXISTS (
             SELECT 1 FROM listing_alert_events e
             WHERE e.listing_key = l.deduplication_key
           )
           AND NOT EXISTS (
             SELECT 1 FROM current_showing_list_draft d
             WHERE (d.generation_input -> 'listingIds') ? l.id::text
           )
         RETURNING l.id`,
        [keys],
      );
      return result.rows.length;
    }
  }
}

function normalizeInput(
  input: InspectListingRetentionInput,
): InspectListingRetentionInput {
  if (!isCanonicalTimestamp(input.asOf)) {
    throw new Error("Listing retention persistence input was invalid");
  }
  try {
    return Object.freeze({
      asOf: input.asOf,
      policy: normalizeListingRetentionPolicy(input.policy),
    });
  } catch {
    throw new Error("Listing retention persistence input was invalid");
  }
}

function normalizeExecuteInput(
  input: ExecuteListingRetentionInput,
): ExecuteListingRetentionInput {
  const normalized = normalizeInput(input);
  if (!validCounts(input.expectedCandidates)) {
    throw new Error("Listing retention persistence input was invalid");
  }
  return Object.freeze({
    ...normalized,
    expectedCandidates: Object.freeze({ ...input.expectedCandidates }),
  });
}

function countCandidates(
  candidates: readonly ListingRetentionCandidate[],
): ListingRetentionAggregateCounts {
  const counts = emptyCounts();
  for (const candidate of candidates) {
    addDeletedCount(counts, candidate.recordKind, 1);
  }
  counts.total =
    counts.searchRuns +
    counts.searchMemberships +
    counts.providerListings +
    counts.alertEvents;
  return Object.freeze(counts);
}

function emptyCounts(): {
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

function addDeletedCount(
  counts: ReturnType<typeof emptyCounts>,
  kind: ListingRetentionRecordKind,
  amount: number,
): void {
  if (kind === "search-run") counts.searchRuns += amount;
  if (kind === "search-membership") counts.searchMemberships += amount;
  if (kind === "provider-listing") counts.providerListings += amount;
  if (kind === "alert-event") counts.alertEvents += amount;
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

function parseMembershipKey(value: string): string {
  const [profileKey, listingId, extra] = value.split("/");
  if (
    profileKey !== "primary" ||
    extra !== undefined ||
    listingId === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      listingId,
    )
  ) {
    throw new Error("Listing retention candidate identity was invalid");
  }
  return listingId;
}

function reportTimestamp(lowerBound: string): string {
  const now = Date.now();
  return new Date(Math.max(now, Date.parse(lowerBound))).toISOString();
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
