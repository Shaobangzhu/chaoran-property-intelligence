import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createListingKey,
  createListingRefreshRequestPlan,
  LISTING_RETENTION_DEFAULTS,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ListingPriceObservation,
  type ListingRefreshPublicationCandidate,
} from "@chaoran-property-intelligence/application";
import {
  createListingAddressKey,
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import { PostgresListingInventoryQuery } from "./postgresListingInventoryQuery.js";
import { PostgresListingRefreshRunRepository } from "./postgresListingRefreshRunRepository.js";
import { PostgresListingRetentionRepository } from "./postgresListingRetentionRepository.js";
import { PostgresListingSearchProfileRepository } from "./postgresListingSearchProfileRepository.js";
import { runBundledMigrations } from "./runBundledMigrations.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const disposableConnectionString = readDisposableConnectionString();
const describeWithDisposablePostgres =
  disposableConnectionString === null ? describe.skip : describe;

describeWithDisposablePostgres(
  "listing refresh repositories against disposable PostgreSQL",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({
        connectionString: requireDisposableConnectionString(),
        max: 1,
      });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("publishes atomically and advances conservative weekly lifecycle states", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runBundledMigrations(database);
        const actorUserId = randomUUID();
        await database.query(
          `INSERT INTO users (
             id, normalized_email, password_hash, role, status
           ) VALUES ($1, 'repository-test@example.com', 'test-hash', 'admin', 'active')`,
          [actorUserId],
        );

        const criteria = normalizeListingSearchCriteria({
          ...defaultListingSearchCriteria,
          cities: ["Corona"],
        });
        const firstRunId = randomUUID();
        const profileRepository = new PostgresListingSearchProfileRepository(
          database,
        );
        const saveResult =
          await profileRepository.savePrimaryProfileAndQueueRefresh({
            expectedRevision: 1,
            criteria,
            updatedByUserId: actorUserId,
            updatedAt: "2026-09-11T15:00:00.000Z",
            runId: firstRunId,
            plan: createListingRefreshRequestPlan(criteria),
          });
        expect(saveResult).toMatchObject({
          status: "updated",
          profile: { revision: 2, appliedRevision: 1 },
          run: { status: "queued", requestedRevision: 2 },
        });

        const runRepository = new PostgresListingRefreshRunRepository(database);
        const firstClaimToken = randomUUID();
        const firstClaim = await runRepository.claimLatestRun({
          profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
          signaledRunId: firstRunId,
          claimToken: firstClaimToken,
          claimedAt: "2026-09-11T15:01:00.000Z",
        });
        expect(firstClaim).toMatchObject({
          status: "claimed",
          claim: { run: { runId: firstRunId, effectiveRevision: 2 } },
        });

        const candidate = createCandidate();
        await expect(
          runRepository.completeRun({
            outcome: "succeeded",
            runId: firstRunId,
            claimToken: firstClaimToken,
            expectedEffectiveRevision: 2,
            completedAt: "2026-09-11T15:03:00.000Z",
            actualProviderRequestCount: 1,
            returnedListingCount: 1,
            publishedCurrentCount: 1,
            candidates: [candidate],
          }),
        ).resolves.toMatchObject({
          status: "completed",
          run: { status: "succeeded", publishedCurrentCount: 1 },
        });

        const inventoryQuery = new PostgresListingInventoryQuery(database);
        await expect(inventoryQuery.findCurrentInventory()).resolves.toMatchObject({
          appliedRevision: 2,
          refreshedAt: "2026-09-11T15:03:00.000Z",
          items: [
            {
              listing: { sourceListingId: candidate.listing.sourceListingId },
              membership: { lifecycleState: "current" },
            },
          ],
        });

        await runEmptyScheduledRefresh(
          runRepository,
          criteria,
          "2026-09-18T15:00:00.000Z",
          "2026-09-18T15:02:00.000Z",
        );
        await expect(
          inventoryQuery.findListingHistory({
            lifecycleStates: ["missing"],
            cursor: null,
            limit: 10,
          }),
        ).resolves.toMatchObject({
          items: [
            {
              membership: {
                lifecycleState: "missing",
                consecutiveCompleteRunAbsenceCount: 1,
              },
            },
          ],
        });

        await runEmptyScheduledRefresh(
          runRepository,
          criteria,
          "2026-09-25T15:00:00.000Z",
          "2026-09-25T15:02:00.000Z",
        );
        await expect(
          inventoryQuery.findListingHistory({
            lifecycleStates: ["inactive"],
            cursor: null,
            limit: 10,
          }),
        ).resolves.toMatchObject({
          items: [
            {
              membership: {
                lifecycleState: "inactive",
                consecutiveCompleteRunAbsenceCount: 2,
                inactiveAt: "2026-09-25T15:02:00.000Z",
              },
            },
          ],
        });
      });
    });

    it("keeps membership and applied revision unchanged when completion fails", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runBundledMigrations(database);
        const criteria = defaultListingSearchCriteria;
        const repository = new PostgresListingRefreshRunRepository(database);
        const runId = randomUUID();
        await repository.queueRun({
          runId,
          profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
          revision: 1,
          triggerReason: "scheduled",
          requestedAt: "2026-09-11T15:00:00.000Z",
          plan: createListingRefreshRequestPlan(criteria),
        });
        const claimToken = randomUUID();
        await repository.claimLatestRun({
          profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
          signaledRunId: runId,
          claimToken,
          claimedAt: "2026-09-11T15:01:00.000Z",
        });

        await expect(
          repository.completeRun({
            outcome: "failed",
            runId,
            claimToken,
            expectedEffectiveRevision: 1,
            completedAt: "2026-09-11T15:02:00.000Z",
            actualProviderRequestCount: 1,
            returnedListingCount: 0,
            failureCode: "provider-timeout",
          }),
        ).resolves.toMatchObject({
          status: "completed",
          run: { status: "failed" },
        });
        await expect(
          database.query(
            `SELECT applied_revision FROM listing_search_profiles
             WHERE profile_key = 'primary'`,
          ),
        ).resolves.toMatchObject({ rows: [{ applied_revision: "1" }] });
        await expect(
          database.query(
            "SELECT count(*)::integer AS count FROM listing_search_memberships",
          ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      });
    });

    it("claims the latest criteria revision and supersedes older queued work", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runBundledMigrations(database);
        const actorUserId = randomUUID();
        await database.query(
          `INSERT INTO users (
             id, normalized_email, password_hash, role, status
           ) VALUES ($1, 'latest-wins@example.com', 'test-hash', 'admin', 'active')`,
          [actorUserId],
        );
        const profileRepository = new PostgresListingSearchProfileRepository(
          database,
        );
        const firstCriteria = normalizeListingSearchCriteria({
          ...defaultListingSearchCriteria,
          cities: ["Corona"],
        });
        const firstRunId = randomUUID();
        await profileRepository.savePrimaryProfileAndQueueRefresh({
          expectedRevision: 1,
          criteria: firstCriteria,
          updatedByUserId: actorUserId,
          updatedAt: "2026-09-11T15:00:00.000Z",
          runId: firstRunId,
          plan: createListingRefreshRequestPlan(firstCriteria),
        });
        const latestCriteria = normalizeListingSearchCriteria({
          ...firstCriteria,
          cities: ["Chino", "Corona"],
        });
        const latestRunId = randomUUID();
        await profileRepository.savePrimaryProfileAndQueueRefresh({
          expectedRevision: 2,
          criteria: latestCriteria,
          updatedByUserId: actorUserId,
          updatedAt: "2026-09-11T15:01:00.000Z",
          runId: latestRunId,
          plan: createListingRefreshRequestPlan(latestCriteria),
        });

        const runRepository = new PostgresListingRefreshRunRepository(database);
        await expect(
          runRepository.claimLatestRun({
            profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
            signaledRunId: firstRunId,
            claimToken: randomUUID(),
            claimedAt: "2026-09-11T15:02:00.000Z",
          }),
        ).resolves.toMatchObject({
          status: "claimed",
          claim: {
            run: { runId: latestRunId, requestedRevision: 3 },
            criteria: latestCriteria,
          },
        });
        await expect(
          database.query(
            `SELECT status, superseded_by_run_id
             FROM listing_search_runs WHERE run_id = $1`,
            [firstRunId],
          ),
        ).resolves.toMatchObject({
          rows: [
            { status: "superseded", superseded_by_run_id: latestRunId },
          ],
        });
      });
    });

    it("previews and executes safe bounded retention without deleting manual listings", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runBundledMigrations(database);
        const actorUserId = randomUUID();
        await database.query(
          `INSERT INTO users (
             id, normalized_email, password_hash, role, status
           ) VALUES ($1, 'retention-test@example.com', 'test-hash', 'admin', 'active')`,
          [actorUserId],
        );
        const failedRunId = randomUUID();
        await database.query(
          `INSERT INTO listing_search_runs (
             run_id, profile_key, requested_revision, trigger_reason, status,
             requested_at, completed_at, selected_markets,
             selected_market_count, planned_provider_request_count, failure_code
           ) VALUES (
             $1, 'primary', 1, 'scheduled', 'failed',
             '2025-01-01T08:00:00Z', '2025-01-01T08:01:00Z',
             '["Chino"]', 1, 1, 'provider-timeout'
           )`,
          [failedRunId],
        );
        const immediatelyUnreferencedId = await insertOldProviderListing(
          database,
          "retention-provider-1",
        );
        const eventReferencedId = await insertOldProviderListing(
          database,
          "retention-provider-2",
        );
        const observationReferencedId = await insertOldProviderListing(
          database,
          "retention-observation-protected",
        );
        const pendingEventReferencedId = await insertOldProviderListing(
          database,
          "retention-pending-event-protected",
        );
        const retainedEventReferencedId = await insertOldProviderListing(
          database,
          "retention-retained-event-protected",
        );
        const showingListReferencedId = await insertOldProviderListing(
          database,
          "retention-showing-list-protected",
        );
        const recentProviderId = await insertOldProviderListing(
          database,
          "retention-recent-provider",
        );
        await database.query(
          "UPDATE listings SET updated_at = '2026-04-01T08:00:00Z' WHERE id = $1",
          [recentProviderId],
        );
        await database.query(
          `INSERT INTO listing_alert_events (
             event_key, listing_key, address_key, kind, formatted_address,
             previous_price, current_price, status, observed_at, sent_at
           ) SELECT
             'new:v1:retention-provider-2', deduplication_key,
             'address:v1:retention-provider-2', 'new-listing', formatted_address,
             NULL, 825000, 'sent', '2025-01-01T08:00:00Z',
             '2025-01-01T08:01:00Z'
           FROM listings WHERE id = $1`,
          [eventReferencedId],
        );
        await database.query(
          `INSERT INTO listing_price_observations (
             address_key, listing_key, source_listing_id, latest_price,
             latest_listed_date, latest_last_seen_date, comparison_ready,
             observed_at, created_at, updated_at
           ) SELECT
             'address:v1:retention-observation-protected', deduplication_key,
             source_listing_id, 825000, '2025-01-01', '2025-01-01', true,
             '2025-01-01T08:00:00Z', '2025-01-01T08:00:00Z',
             '2025-01-01T08:00:00Z'
           FROM listings WHERE id = $1`,
          [observationReferencedId],
        );
        await insertRetentionEvent(database, pendingEventReferencedId, {
          identity: "pending",
          observedAt: "2025-01-01T08:00:00Z",
          status: "pending",
        });
        await insertRetentionEvent(database, retainedEventReferencedId, {
          identity: "retained",
          observedAt: "2026-08-01T08:00:00Z",
          status: "sent",
        });
        await database.query(
          `INSERT INTO current_showing_list_draft (
             generation_id, created_by_user_id, prompt_version, model,
             duration_ms, generation_input, draft, artifact_key,
             artifact_etag, status, delivery_status, generated_at, updated_at
           ) VALUES (
             $1, $2, 'retention-test-v1', 'fake-model', 1,
             jsonb_build_object('listingIds', jsonb_build_array($3::text)),
             '{}'::jsonb, 'showing-lists/current.pdf', 'retention-etag',
             'draft', 'pending', '2026-09-01T08:00:00Z',
             '2026-09-01T08:00:00Z'
           )`,
          [randomUUID(), actorUserId, showingListReferencedId],
        );

        const membershipRunId = randomUUID();
        await database.query(
          `INSERT INTO listing_search_runs (
             run_id, profile_key, requested_revision, effective_revision,
             trigger_reason, status, claim_token, requested_at, started_at,
             completed_at, selected_markets, selected_market_count,
             planned_provider_request_count, actual_provider_request_count,
             returned_listing_count, published_current_count
           ) VALUES (
             $1, 'primary', 2, 1, 'scheduled', 'succeeded', $2,
             '2025-01-01T08:00:00Z', '2025-01-01T08:00:30Z',
             '2025-01-01T08:01:00Z', '["Chino"]', 1, 1, 1, 4, 2
           )`,
          [membershipRunId, randomUUID()],
        );
        const currentMembershipId = await insertOldProviderListing(
          database,
          "retention-current-membership",
        );
        const missingMembershipId = await insertOldProviderListing(
          database,
          "retention-missing-membership",
        );
        const inactiveMembershipId = await insertOldProviderListing(
          database,
          "retention-inactive-membership",
        );
        const outOfScopeMembershipId = await insertOldProviderListing(
          database,
          "retention-out-of-scope-membership",
        );
        const recentInactiveMembershipId = await insertOldProviderListing(
          database,
          "retention-recent-inactive-membership",
        );
        await insertRetentionMembership(
          database,
          membershipRunId,
          currentMembershipId,
          "current",
          "2025-01-01T08:00:00Z",
        );
        await insertRetentionMembership(
          database,
          membershipRunId,
          missingMembershipId,
          "missing",
          "2025-01-01T08:00:00Z",
        );
        await insertRetentionMembership(
          database,
          membershipRunId,
          inactiveMembershipId,
          "inactive",
          "2025-01-01T08:00:00Z",
        );
        await insertRetentionMembership(
          database,
          membershipRunId,
          outOfScopeMembershipId,
          "out_of_scope",
          "2025-01-01T08:00:00Z",
        );
        await insertRetentionMembership(
          database,
          membershipRunId,
          recentInactiveMembershipId,
          "inactive",
          "2026-08-01T08:00:00Z",
        );
        await database.query(
          `INSERT INTO listings (
             deduplication_key, source, source_listing_id, mls_name, mls_number,
             formatted_address, address_line_1, address_line_2, city, state,
             zip_code, latitude, longitude, property_type, bedrooms, bathrooms,
             price, status, listed_date, last_seen_date, first_discovered_at,
             notification_status, created_by_user_id, created_at, updated_at
           ) VALUES (
             $1, 'manual', NULL, NULL, NULL, '1 Manual Way, Chino, CA 91710',
             '1 Manual Way', NULL, 'Chino', 'CA', '91710', 34.0, -117.7,
             NULL, NULL, NULL, NULL, 'Active', NULL, '2025-01-01',
             '2025-01-01T08:00:00.000Z', 'not_applicable', $2,
             '2025-01-01T08:00:00Z', '2025-01-01T08:00:00Z'
           )`,
          [`manual:${randomUUID()}`, actorUserId],
        );

        const retention = new PostgresListingRetentionRepository(database);
        const input = {
          asOf: "2026-09-11T15:00:00.000Z",
          policy: LISTING_RETENTION_DEFAULTS,
        };
        const firstCandidates = await retention.listCandidates(input);
        expect(firstCandidates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              recordKind: "search-run",
              recordKey: failedRunId,
            }),
            expect.objectContaining({
              recordKind: "provider-listing",
              recordKey: immediatelyUnreferencedId,
            }),
            expect.objectContaining({ recordKind: "alert-event" }),
            expect.objectContaining({
              recordKind: "search-membership",
              recordKey: `primary/${inactiveMembershipId}`,
            }),
            expect.objectContaining({
              recordKind: "search-membership",
              recordKey: `primary/${outOfScopeMembershipId}`,
            }),
          ]),
        );
        expect(firstCandidates).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ recordKey: currentMembershipId }),
            expect.objectContaining({ recordKey: missingMembershipId }),
            expect.objectContaining({ recordKey: observationReferencedId }),
            expect.objectContaining({ recordKey: pendingEventReferencedId }),
            expect.objectContaining({ recordKey: retainedEventReferencedId }),
            expect.objectContaining({ recordKey: showingListReferencedId }),
            expect.objectContaining({ recordKey: recentProviderId }),
            expect.objectContaining({
              recordKey: `primary/${recentInactiveMembershipId}`,
            }),
          ]),
        );
        const firstCounts = aggregateRetentionCandidates(firstCandidates);
        await expect(
          retention.execute({ ...input, expectedCandidates: firstCounts }),
        ).resolves.toMatchObject({
          deleted: firstCounts,
          hasMore: true,
        });

        const secondCandidates = await retention.listCandidates(input);
        expect(secondCandidates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              recordKind: "provider-listing",
              recordKey: eventReferencedId,
            }),
            expect.objectContaining({
              recordKind: "provider-listing",
              recordKey: inactiveMembershipId,
            }),
            expect.objectContaining({
              recordKind: "provider-listing",
              recordKey: outOfScopeMembershipId,
            }),
          ]),
        );
        await retention.execute({
          ...input,
          expectedCandidates: aggregateRetentionCandidates(secondCandidates),
        });
        const repeatCandidates = await retention.listCandidates(input);
        expect(repeatCandidates).toEqual([]);
        await expect(
          retention.execute({
            ...input,
            expectedCandidates:
              aggregateRetentionCandidates(repeatCandidates),
          }),
        ).resolves.toMatchObject({ deleted: { total: 0 }, hasMore: false });
        await expect(
          database.query(
            "SELECT count(*)::integer AS count FROM listings WHERE source = 'manual'",
          ),
        ).resolves.toEqual({ rows: [{ count: 1 }] });
        const protectedRows = await database.query(
          `SELECT id FROM listings
           WHERE id = ANY($1::uuid[])
           ORDER BY id`,
          [[
            currentMembershipId,
            missingMembershipId,
            observationReferencedId,
            pendingEventReferencedId,
            retainedEventReferencedId,
            showingListReferencedId,
            recentProviderId,
            recentInactiveMembershipId,
          ]],
        );
        expect(protectedRows.rows).toHaveLength(8);
      });
    });
  },
);

async function insertOldProviderListing(
  database: SqlDatabase,
  sourceListingId: string,
): Promise<string> {
  const result = await database.query(
    `INSERT INTO listings (
       deduplication_key, source, source_listing_id, mls_name, mls_number,
       formatted_address, address_line_1, address_line_2, city, state,
       zip_code, latitude, longitude, property_type, bedrooms, bathrooms,
       price, status, listed_date, last_seen_date, first_discovered_at,
       notification_status, created_at, updated_at
     ) VALUES (
       $1, 'rentcast', $2, 'CRMLS', $2,
       $3, $3, NULL, 'Chino', 'CA', '91710', 34.0, -117.7,
       'Single Family', 4, 3, 825000, 'Active', '2025-01-01',
       '2025-01-01', '2025-01-01T08:00:00.000Z', 'sent',
       '2025-01-01T08:00:00Z', '2025-01-01T08:00:00Z'
     ) RETURNING id`,
    [
      `rentcast:${sourceListingId}`,
      sourceListingId,
      `${sourceListingId}, Chino, CA 91710`,
    ],
  );
  const row = result.rows[0] as { id?: unknown } | undefined;
  if (typeof row?.id !== "string") {
    throw new Error("Disposable retention listing identity was malformed");
  }
  return row.id;
}

async function insertRetentionEvent(
  database: SqlDatabase,
  listingId: string,
  input: {
    readonly identity: string;
    readonly observedAt: string;
    readonly status: "pending" | "sent";
  },
): Promise<void> {
  await database.query(
    `INSERT INTO listing_alert_events (
       event_key, listing_key, address_key, kind, formatted_address,
       previous_price, current_price, status, observed_at, sent_at
     ) SELECT
       $2, deduplication_key, $3, 'new-listing', formatted_address,
       NULL, 825000, $4, $5,
       CASE WHEN $4 = 'sent' THEN $5::timestamptz ELSE NULL END
     FROM listings WHERE id = $1`,
    [
      listingId,
      `new:v1:retention-${input.identity}`,
      `address:v1:retention-${input.identity}`,
      input.status,
      input.observedAt,
    ],
  );
}

async function insertRetentionMembership(
  database: SqlDatabase,
  runId: string,
  listingId: string,
  state: "current" | "missing" | "inactive" | "out_of_scope",
  lifecycleChangedAt: string,
): Promise<void> {
  const absenceCount = state === "missing" ? 1 : state === "inactive" ? 2 : 0;
  await database.query(
    `INSERT INTO listing_search_memberships (
       profile_key, listing_id, applied_revision, last_successful_run_id,
       lifecycle_state, first_matched_at, last_matched_at,
       last_server_observed_at, consecutive_complete_run_absence_count,
       inactive_at, lifecycle_changed_at, created_at, updated_at
     ) VALUES (
       'primary', $1, 1, $2, $3,
       '2025-01-01T08:00:00Z', '2025-01-01T08:00:00Z',
       '2025-01-01T08:00:00Z', $4,
       CASE WHEN $3 = 'inactive' THEN $5::timestamptz ELSE NULL END,
       $5, '2025-01-01T08:00:00Z', $5
     )`,
    [listingId, runId, state, absenceCount, lifecycleChangedAt],
  );
}

function aggregateRetentionCandidates(
  candidates: readonly { readonly recordKind: string }[],
) {
  const counts = {
    searchRuns: 0,
    searchMemberships: 0,
    providerListings: 0,
    alertEvents: 0,
    total: candidates.length,
  };
  for (const candidate of candidates) {
    if (candidate.recordKind === "search-run") counts.searchRuns += 1;
    if (candidate.recordKind === "search-membership")
      counts.searchMemberships += 1;
    if (candidate.recordKind === "provider-listing")
      counts.providerListings += 1;
    if (candidate.recordKind === "alert-event") counts.alertEvents += 1;
  }
  return counts;
}

async function runEmptyScheduledRefresh(
  repository: PostgresListingRefreshRunRepository,
  criteria: typeof defaultListingSearchCriteria,
  requestedAt: string,
  completedAt: string,
): Promise<void> {
  const runId = randomUUID();
  await repository.queueRun({
    runId,
    profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
    revision: 2,
    triggerReason: "scheduled",
    requestedAt,
    plan: createListingRefreshRequestPlan(criteria),
  });
  const claimToken = randomUUID();
  await repository.claimLatestRun({
    profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
    signaledRunId: runId,
    claimToken,
    claimedAt: new Date(Date.parse(requestedAt) + 60_000).toISOString(),
  });
  await repository.completeRun({
    outcome: "succeeded",
    runId,
    claimToken,
    expectedEffectiveRevision: 2,
    completedAt,
    actualProviderRequestCount: 1,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    candidates: [],
  });
}

function createCandidate(): ListingRefreshPublicationCandidate {
  const listing: RentCastNormalizedListing = {
    source: "rentcast",
    sourceListingId: "repository-rentcast-1",
    mlsName: "CRMLS",
    mlsNumber: "REPOSITORY1",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    addressLine1: "3420 New York Dr",
    addressLine2: null,
    city: "Corona",
    state: "CA",
    zipCode: "92882",
    latitude: 33.8753,
    longitude: -117.5664,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    price: 825000,
    status: "Active",
    listedDate: "2026-09-10",
    lastSeenDate: "2026-09-11",
    firstDiscoveredAt: "2026-09-11T15:02:00.000Z",
  };
  const observation: ListingPriceObservation = {
    addressKey: createListingAddressKey(listing),
    listingKey: createListingKey(listing),
    sourceListingId: listing.sourceListingId,
    latestPrice: listing.price,
    latestListedDate: listing.listedDate,
    latestLastSeenDate: listing.lastSeenDate,
    comparisonReady: true,
    observedAt: "2026-09-11T15:02:00.000Z",
  };
  return {
    listing,
    observation,
    event: null,
    acquisitionEligible: true,
    currentDisplayEligible: true,
  };
}

async function withIsolatedSchema(
  pool: pg.Pool,
  operation: (database: SqlDatabase) => Promise<void>,
): Promise<void> {
  const schema = `cpi_repositories_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  const database = new PinnedSqlDatabase(client);
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await operation(database);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
}

class PinnedSqlDatabase implements SqlDatabase {
  constructor(private readonly client: pg.PoolClient) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    const result = await this.client.query(text, [...parameters]);
    return { rows: result.rows };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const result = await operation(this);
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {}
}

function readDisposableConnectionString(): string | null {
  if (process.env.CPI_RUN_DISPOSABLE_POSTGRES_TESTS !== "true") {
    return null;
  }
  const connectionString = process.env.CPI_DISPOSABLE_POSTGRES_URL;
  if (connectionString === undefined) {
    throw new Error("CPI_DISPOSABLE_POSTGRES_URL is required");
  }
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.startsWith("cpi_disposable_")) {
    throw new Error(
      "Disposable repository tests require a cpi_disposable_ database",
    );
  }
  return connectionString;
}

function requireDisposableConnectionString(): string {
  if (disposableConnectionString === null) {
    throw new Error("Disposable PostgreSQL tests were not enabled");
  }
  return disposableConnectionString;
}
