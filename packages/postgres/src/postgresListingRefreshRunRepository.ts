import {
  assertValidListingAlertBaselineEntry,
  listingAlertEventSchema,
  normalizeClaimLatestListingRefreshRunResult,
  normalizeCompleteListingRefreshRunResult,
  normalizeListingRefreshRequestPlan,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ClaimLatestListingRefreshRunInput,
  type ClaimLatestListingRefreshRunResult,
  type CompleteListingRefreshRunInput,
  type CompleteListingRefreshRunResult,
  type ListingRefreshPublicationCandidate,
  type ListingRefreshRun,
  type ListingRefreshRunRepositoryPort,
  type QueueListingRefreshInput,
} from "@chaoran-property-intelligence/application";
import {
  normalizeListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import {
  insertQueuedListingRefreshRun,
  listingRefreshRunColumns,
  parseListingRefreshRun,
  parseRequiredListingRefreshRun,
} from "./listingRefreshRunRow.js";
import { readRecord, readString } from "./listingRow.js";
import {
  persistEvent,
  upsertListingReturningId,
  upsertObservation,
} from "./postgresListingAlertRepository.js";
import type { SqlConnection, SqlDatabase } from "./sqlDatabase.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PostgresListingRefreshRunRepository
  implements ListingRefreshRunRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async queueRun(input: QueueListingRefreshInput): Promise<ListingRefreshRun> {
    const queued = normalizeQueueInput(input);
    return this.database.transaction(async (connection) => {
      const profile = await lockProfile(connection);
      if (profile.revision !== queued.revision) {
        throw new Error(
          "Listing refresh run revision did not match the current profile",
        );
      }

      const inserted = await insertQueuedListingRefreshRun(connection, queued);
      if (inserted !== null) {
        return inserted;
      }

      const existing = await connection.query(
        `SELECT ${listingRefreshRunColumns}
         FROM listing_search_runs
         WHERE run_id = $1
            OR (
              profile_key = $2
              AND requested_revision = $3
              AND trigger_reason = $4
              AND status IN ('queued', 'running')
            )
         ORDER BY (run_id = $1) DESC, requested_at DESC, run_id DESC
         LIMIT 1`,
        [
          queued.runId,
          queued.profileKey,
          queued.revision,
          queued.triggerReason,
        ],
      );
      const run = parseRequiredListingRefreshRun(existing);
      if (
        run.profileKey !== queued.profileKey ||
        run.requestedRevision !== queued.revision ||
        run.triggerReason !== queued.triggerReason
      ) {
        throw new Error("Listing refresh run identity conflicted");
      }
      return run;
    });
  }

  async findLatestRun(): Promise<ListingRefreshRun | null> {
    const result = await this.database.query(
      `SELECT ${listingRefreshRunColumns}
       FROM listing_search_runs
       WHERE profile_key = $1
       ORDER BY requested_at DESC, run_id DESC
       LIMIT 1`,
      [PRIMARY_LISTING_SEARCH_PROFILE_KEY],
    );
    return result.rows.length === 0
      ? null
      : parseListingRefreshRun(result.rows[0]);
  }

  async claimLatestRun(
    input: ClaimLatestListingRefreshRunInput,
  ): Promise<ClaimLatestListingRefreshRunResult> {
    const claim = normalizeClaimInput(input);
    return this.database.transaction(async (connection) => {
      const profile = await lockProfile(connection);
      const runningResult = await connection.query(
        `SELECT run_id
         FROM listing_search_runs
         WHERE profile_key = $1 AND status = 'running'
         LIMIT 1
         FOR UPDATE`,
        [claim.profileKey],
      );
      if (runningResult.rows.length > 0) {
        return { status: "already-running" };
      }

      const queuedResult = await connection.query(
        `SELECT ${listingRefreshRunColumns}
         FROM listing_search_runs
         WHERE profile_key = $1
           AND status = 'queued'
           AND requested_revision = $2
         ORDER BY requested_revision DESC, requested_at DESC, run_id DESC
         LIMIT 1
         FOR UPDATE`,
        [claim.profileKey, profile.revision],
      );
      if (queuedResult.rows.length === 0) {
        await connection.query(
          `UPDATE listing_search_runs
           SET status = 'failed',
               completed_at = $2,
               failure_code = 'stale-criteria-revision'
           WHERE profile_key = $1
             AND status = 'queued'
             AND requested_revision < $3`,
          [claim.profileKey, claim.claimedAt, profile.revision],
        );
        return { status: "no-queued-run" };
      }

      const selected = parseRequiredListingRefreshRun(queuedResult);
      if (claim.claimedAt < selected.requestedAt) {
        throwInvalidInput();
      }
      await connection.query(
        `UPDATE listing_search_runs
         SET status = 'superseded',
             completed_at = $3,
             superseded_by_run_id = $2
         WHERE profile_key = $1
           AND status = 'queued'
           AND run_id <> $2`,
        [claim.profileKey, selected.runId, claim.claimedAt],
      );
      const claimedResult = await connection.query(
        `UPDATE listing_search_runs
         SET status = 'running',
             effective_revision = $2,
             claim_token = $3,
             started_at = $4
         WHERE run_id = $1 AND status = 'queued'
         RETURNING ${listingRefreshRunColumns}`,
        [selected.runId, profile.revision, claim.claimToken, claim.claimedAt],
      );
      const run = parseRequiredListingRefreshRun(claimedResult);
      return normalizeClaimLatestListingRefreshRunResult({
        status: "claimed",
        claim: {
          claimToken: claim.claimToken,
          run,
          criteria: profile.criteria,
          appliedRevision: profile.appliedRevision,
        },
      });
    });
  }

  async completeRun(
    input: CompleteListingRefreshRunInput,
  ): Promise<CompleteListingRefreshRunResult> {
    const completion = normalizeCompletionInput(input);
    return this.database.transaction(async (connection) => {
      // Every refresh mutation takes the profile lock before a run lock. Keeping
      // this order aligned with queue/claim avoids a claim-completion deadlock.
      const profile = await lockProfile(connection);
      const runResult = await connection.query(
        `SELECT ${listingRefreshRunColumns}
         FROM listing_search_runs
         WHERE run_id = $1
         LIMIT 1
         FOR UPDATE`,
        [completion.runId],
      );
      if (runResult.rows.length === 0) {
        return { status: "stale-claim" };
      }
      const run = parseRequiredListingRefreshRun(runResult);
      if (run.status === "succeeded" || run.status === "failed") {
        return readClaimToken(runResult.rows[0]) === completion.claimToken &&
          completionMatchesRun(completion, run)
          ? normalizeCompleteListingRefreshRunResult({
              status: "already-completed",
              run,
            })
          : { status: "stale-claim" };
      }
      if (
        run.status !== "running" ||
        run.effectiveRevision !== completion.expectedEffectiveRevision ||
        readClaimToken(runResult.rows[0]) !== completion.claimToken ||
        run.startedAt === null ||
        completion.completedAt < run.startedAt
      ) {
        return { status: "stale-claim" };
      }
      if (
        completion.actualProviderRequestCount >
          run.plannedProviderRequestCount ||
        (completion.outcome === "succeeded" &&
          completion.actualProviderRequestCount !==
            run.plannedProviderRequestCount)
      ) {
        throwInvalidInput();
      }
      if (
        completion.outcome === "succeeded" &&
        (completion.candidates.length > completion.returnedListingCount ||
          (profile.appliedRevision !== completion.expectedEffectiveRevision &&
            completion.candidates.some(
              (candidate) => candidate.event !== null,
            )))
      ) {
        throwInvalidInput();
      }

      if (profile.revision !== completion.expectedEffectiveRevision) {
        await markRunFailed(
          connection,
          completion,
          "criteria-revision-conflict",
        );
        return { status: "criteria-revision-conflict" };
      }
      if (completion.outcome === "failed") {
        const failed = await markRunFailed(
          connection,
          completion,
          completion.failureCode,
        );
        return normalizeCompleteListingRefreshRunResult({
          status: "completed",
          run: failed,
        });
      }

      const listingIds = new Map<string, string>();
      const addressKeys = completion.candidates
        .map((candidate) => candidate.observation.addressKey)
        .sort((left, right) => left.localeCompare(right));
      for (const addressKey of addressKeys) {
        await connection.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`cpi:listing-alert:${addressKey}`],
        );
      }
      for (const candidate of completion.candidates) {
        const notificationStatus =
          candidate.event?.kind === "new-listing" ? "pending" : "baseline";
        const listingId = await upsertListingReturningId(
          connection,
          candidate.listing,
          candidate.observation.listingKey,
          notificationStatus,
        );
        listingIds.set(candidate.observation.listingKey, listingId);
        await upsertObservation(connection, candidate.observation);
        if (candidate.event !== null) {
          await persistEvent(connection, candidate.event);
        }
      }

      await publishMemberships(
        connection,
        completion,
        run,
        profile.appliedRevision,
        listingIds,
      );
      const profileResult = await connection.query(
        `UPDATE listing_search_profiles
         SET applied_revision = $2
         WHERE profile_key = $1 AND revision = $2
         RETURNING applied_revision`,
        [run.profileKey, completion.expectedEffectiveRevision],
      );
      if (profileResult.rows.length !== 1) {
        throw new Error("Listing refresh applied revision update conflicted");
      }
      const completedResult = await connection.query(
        `UPDATE listing_search_runs
         SET status = 'succeeded',
             completed_at = $3,
             actual_provider_request_count = $4,
             returned_listing_count = $5,
             published_current_count = $6
         WHERE run_id = $1
           AND claim_token = $2
           AND status = 'running'
         RETURNING ${listingRefreshRunColumns}`,
        [
          completion.runId,
          completion.claimToken,
          completion.completedAt,
          completion.actualProviderRequestCount,
          completion.returnedListingCount,
          completion.publishedCurrentCount,
        ],
      );
      return normalizeCompleteListingRefreshRunResult({
        status: "completed",
        run: parseRequiredListingRefreshRun(completedResult),
      });
    });
  }
}

interface LockedProfile {
  readonly revision: number;
  readonly appliedRevision: number;
  readonly criteria: ListingSearchCriteriaV1;
}

async function lockProfile(connection: SqlConnection): Promise<LockedProfile> {
  const result = await connection.query(
    `SELECT revision, applied_revision, criteria
     FROM listing_search_profiles
     WHERE profile_key = $1
     LIMIT 1
     FOR UPDATE`,
    [PRIMARY_LISTING_SEARCH_PROFILE_KEY],
  );
  if (result.rows.length !== 1) {
    throw new Error("PostgreSQL listing search profile was missing");
  }
  const row = readRecord(result.rows[0]);
  const revision = readPositiveInteger(row.revision);
  const appliedRevision = readPositiveInteger(row.applied_revision);
  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria(row.criteria);
  } catch {
    return throwInvalidRow();
  }
  if (appliedRevision > revision) {
    return throwInvalidRow();
  }
  return { revision, appliedRevision, criteria };
}

async function markRunFailed(
  connection: SqlConnection,
  input: CompleteListingRefreshRunInput,
  failureCode: string,
): Promise<ListingRefreshRun> {
  const result = await connection.query(
    `UPDATE listing_search_runs
     SET status = 'failed',
         completed_at = $3,
         actual_provider_request_count = $4,
         returned_listing_count = $5,
         failure_code = $6
     WHERE run_id = $1 AND claim_token = $2 AND status = 'running'
     RETURNING ${listingRefreshRunColumns}`,
    [
      input.runId,
      input.claimToken,
      input.completedAt,
      input.actualProviderRequestCount,
      input.returnedListingCount,
      failureCode,
    ],
  );
  return parseRequiredListingRefreshRun(result);
}

async function publishMemberships(
  connection: SqlConnection,
  input: Extract<CompleteListingRefreshRunInput, { outcome: "succeeded" }>,
  run: ListingRefreshRun,
  previousAppliedRevision: number,
  listingIds: ReadonlyMap<string, string>,
): Promise<void> {
  const observedListingIds: string[] = [];
  for (const candidate of input.candidates) {
    const listingId = listingIds.get(candidate.observation.listingKey);
    if (listingId === undefined) {
      throw new Error("Listing refresh publication identity was unavailable");
    }
    observedListingIds.push(listingId);
    if (candidate.currentDisplayEligible) {
      await connection.query(
        `INSERT INTO listing_search_memberships (
           profile_key, listing_id, applied_revision, last_successful_run_id,
           lifecycle_state, first_matched_at, last_matched_at,
           last_server_observed_at, consecutive_complete_run_absence_count,
           inactive_at, explicit_provider_status,
           explicit_provider_status_observed_at, lifecycle_changed_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, 'current', $5, $5, $5, 0,
           NULL, NULL, NULL, $6, $6, $6
         )
         ON CONFLICT (profile_key, listing_id) DO UPDATE SET
           applied_revision = EXCLUDED.applied_revision,
           last_successful_run_id = EXCLUDED.last_successful_run_id,
           lifecycle_state = 'current',
           last_matched_at = GREATEST(
             listing_search_memberships.last_matched_at,
             EXCLUDED.last_matched_at
           ),
           last_server_observed_at = GREATEST(
             listing_search_memberships.last_server_observed_at,
             EXCLUDED.last_server_observed_at
           ),
           consecutive_complete_run_absence_count = 0,
           inactive_at = NULL,
           explicit_provider_status = NULL,
           explicit_provider_status_observed_at = NULL,
           lifecycle_changed_at = CASE
             WHEN listing_search_memberships.lifecycle_state = 'current'
               THEN listing_search_memberships.lifecycle_changed_at
             ELSE EXCLUDED.lifecycle_changed_at
           END,
           updated_at = EXCLUDED.updated_at`,
        [
          run.profileKey,
          listingId,
          input.expectedEffectiveRevision,
          run.runId,
          candidate.observation.observedAt,
          input.completedAt,
        ],
      );
      continue;
    }

    await connection.query(
      `UPDATE listing_search_memberships
       SET applied_revision = $3,
           last_successful_run_id = $4,
           lifecycle_state = 'out_of_scope',
           last_server_observed_at = GREATEST(last_server_observed_at, $5),
           consecutive_complete_run_absence_count = 0,
           inactive_at = NULL,
           explicit_provider_status = NULL,
           explicit_provider_status_observed_at = NULL,
           lifecycle_changed_at = CASE
             WHEN lifecycle_state = 'out_of_scope' THEN lifecycle_changed_at
             ELSE $6
           END,
           updated_at = $6
       WHERE profile_key = $1 AND listing_id = $2
         AND lifecycle_state <> 'sold'`,
      [
        run.profileKey,
        listingId,
        input.expectedEffectiveRevision,
        run.runId,
        candidate.observation.observedAt,
        input.completedAt,
      ],
    );
  }

  const changedScope = previousAppliedRevision !== input.expectedEffectiveRevision;
  await connection.query(
    `UPDATE listing_search_memberships
     SET applied_revision = $2,
         last_successful_run_id = $3,
         lifecycle_state = CASE
           WHEN lifecycle_state = 'sold' THEN 'sold'
           WHEN $5::boolean THEN 'out_of_scope'
           WHEN lifecycle_state = 'current' THEN 'missing'
           WHEN lifecycle_state = 'missing' AND $6::boolean THEN 'inactive'
           ELSE lifecycle_state
         END,
         consecutive_complete_run_absence_count = CASE
           WHEN lifecycle_state = 'sold' OR $5::boolean
             OR lifecycle_state = 'out_of_scope' THEN 0
           WHEN lifecycle_state = 'current' THEN 1
           WHEN lifecycle_state = 'missing' AND $6::boolean
             THEN LEAST(consecutive_complete_run_absence_count + 1, 2147483647)
           ELSE consecutive_complete_run_absence_count
         END,
         inactive_at = CASE
           WHEN lifecycle_state = 'missing' AND $6::boolean THEN $4
           WHEN lifecycle_state = 'inactive' THEN inactive_at
           ELSE NULL
         END,
         explicit_provider_status = CASE
           WHEN lifecycle_state = 'sold' THEN explicit_provider_status
           ELSE NULL
         END,
         explicit_provider_status_observed_at = CASE
           WHEN lifecycle_state = 'sold'
             THEN explicit_provider_status_observed_at
           ELSE NULL
         END,
         lifecycle_changed_at = CASE
           WHEN $5::boolean AND lifecycle_state <> 'out_of_scope'
             AND lifecycle_state <> 'sold' THEN $4
           WHEN NOT $5::boolean AND lifecycle_state = 'current' THEN $4
           WHEN NOT $5::boolean AND lifecycle_state = 'missing'
             AND $6::boolean THEN $4
           ELSE lifecycle_changed_at
         END,
         updated_at = $4
     WHERE profile_key = $1
       AND NOT (listing_id = ANY($7::uuid[]))`,
    [
      run.profileKey,
      input.expectedEffectiveRevision,
      run.runId,
      input.completedAt,
      changedScope,
      run.triggerReason === "scheduled",
      observedListingIds,
    ],
  );
}

function normalizeQueueInput(
  input: QueueListingRefreshInput,
): QueueListingRefreshInput {
  if (
    !isUuid(input.runId) ||
    input.profileKey !== PRIMARY_LISTING_SEARCH_PROFILE_KEY ||
    !isPositiveSafeInteger(input.revision) ||
    !["criteria-change", "scheduled", "manual-retry"].includes(
      input.triggerReason,
    ) ||
    !isCanonicalTimestamp(input.requestedAt)
  ) {
    return throwInvalidInput();
  }
  try {
    return Object.freeze({
      ...input,
      plan: normalizeListingRefreshRequestPlan(input.plan),
    });
  } catch {
    return throwInvalidInput();
  }
}

function normalizeClaimInput(
  input: ClaimLatestListingRefreshRunInput,
): ClaimLatestListingRefreshRunInput {
  if (
    input.profileKey !== PRIMARY_LISTING_SEARCH_PROFILE_KEY ||
    (input.signaledRunId !== null && !isUuid(input.signaledRunId)) ||
    !isUuid(input.claimToken) ||
    !isCanonicalTimestamp(input.claimedAt)
  ) {
    return throwInvalidInput();
  }
  return Object.freeze({ ...input });
}

function normalizeCompletionInput(
  input: CompleteListingRefreshRunInput,
): CompleteListingRefreshRunInput {
  if (
    !isUuid(input.runId) ||
    !isUuid(input.claimToken) ||
    !isPositiveSafeInteger(input.expectedEffectiveRevision) ||
    !isCanonicalTimestamp(input.completedAt) ||
    !isBoundedCount(input.actualProviderRequestCount, 7) ||
    !isBoundedCount(input.returnedListingCount, 3_500)
  ) {
    return throwInvalidInput();
  }
  if (input.outcome === "failed") {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.failureCode)) {
      return throwInvalidInput();
    }
    return input;
  }
  if (
    !isBoundedCount(input.publishedCurrentCount, 3_500) ||
    input.publishedCurrentCount > input.returnedListingCount ||
    input.publishedCurrentCount !==
      input.candidates.filter((candidate) => candidate.currentDisplayEligible)
        .length
  ) {
    return throwInvalidInput();
  }
  const addresses = new Set<string>();
  const listingKeys = new Set<string>();
  for (const candidate of input.candidates) {
    validateCandidate(candidate);
    if (
      addresses.has(candidate.observation.addressKey) ||
      listingKeys.has(candidate.observation.listingKey)
    ) {
      return throwInvalidInput();
    }
    addresses.add(candidate.observation.addressKey);
    listingKeys.add(candidate.observation.listingKey);
  }
  return input;
}

function validateCandidate(candidate: ListingRefreshPublicationCandidate): void {
  if (candidate.acquisitionEligible !== true) {
    return throwInvalidInput();
  }
  try {
    assertValidListingAlertBaselineEntry(candidate);
  } catch {
    return throwInvalidInput();
  }
  if (candidate.event === null) {
    return;
  }
  const event = listingAlertEventSchema.safeParse(candidate.event);
  if (
    !event.success ||
    event.data.status !== "pending" ||
    event.data.listingKey !== candidate.observation.listingKey ||
    event.data.addressKey !== candidate.observation.addressKey ||
    event.data.currentPrice !== candidate.observation.latestPrice ||
    event.data.observedAt !== candidate.observation.observedAt ||
    event.data.formattedAddress !== candidate.listing.formattedAddress
  ) {
    return throwInvalidInput();
  }
}

function completionMatchesRun(
  input: CompleteListingRefreshRunInput,
  run: ListingRefreshRun,
): boolean {
  return (
    run.effectiveRevision === input.expectedEffectiveRevision &&
    run.completedAt === input.completedAt &&
    run.actualProviderRequestCount === input.actualProviderRequestCount &&
    run.returnedListingCount === input.returnedListingCount &&
    (input.outcome === "succeeded"
      ? run.status === "succeeded" &&
        run.publishedCurrentCount === input.publishedCurrentCount
      : run.status === "failed" && run.failureCode === input.failureCode)
  );
}

function readClaimToken(value: unknown): string | null {
  const row = readRecord(value);
  return row.claim_token === null ? null : readString(row, "claim_token");
}

function readPositiveInteger(value: unknown): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    return throwInvalidRow();
  }
  return parsed;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function throwInvalidInput(): never {
  throw new Error("Listing refresh persistence input was invalid");
}

function throwInvalidRow(): never {
  throw new Error(
    "PostgreSQL listing refresh state did not match the expected schema",
  );
}
