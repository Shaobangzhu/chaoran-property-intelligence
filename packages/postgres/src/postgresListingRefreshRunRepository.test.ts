import { describe, expect, it } from "vitest";

import {
  createListingRefreshRequestPlan,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
} from "@chaoran-property-intelligence/application";
import { defaultListingSearchCriteria } from "@chaoran-property-intelligence/domain";

import { PostgresListingRefreshRunRepository } from "./postgresListingRefreshRunRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingRefreshRunRepository", () => {
  it("claims the latest queued run and supersedes all other unstarted work", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [profileRow()] },
      { rows: [] },
      { rows: [runRow()] },
      { rows: [] },
      {
        rows: [
          runRow({
            effective_revision: "2",
            status: "running",
            claim_token: claimToken,
            started_at: new Date(claimedAt),
          }),
        ],
      },
    ]);
    const repository = new PostgresListingRefreshRunRepository(database);

    const result = await repository.claimLatestRun({
      profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
      signaledRunId: "0198c7d2-7668-7775-b0fc-b789690a60ff",
      claimToken,
      claimedAt,
    });

    expect(result).toMatchObject({
      status: "claimed",
      claim: {
        claimToken,
        run: { runId, status: "running", effectiveRevision: 2 },
        criteria: defaultListingSearchCriteria,
        appliedRevision: 1,
      },
    });
    expect(database.transactionCount).toBe(1);
    expect(database.queries[2]?.text).toContain("ORDER BY requested_revision DESC");
    expect(database.queries[3]?.text).toContain("status = 'superseded'");
    expect(database.queries[3]?.parameters).toEqual([
      "primary",
      runId,
      claimedAt,
    ]);
    expect(database.queries[4]?.text).toContain("status = 'running'");
  });

  it("returns already-running without selecting another queued run", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [profileRow()] },
      { rows: [{ run_id: runId }] },
    ]);
    const repository = new PostgresListingRefreshRunRepository(database);

    await expect(
      repository.claimLatestRun({
        profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        signaledRunId: null,
        claimToken,
        claimedAt,
      }),
    ).resolves.toEqual({ status: "already-running" });
    expect(database.queries).toHaveLength(2);
  });

  it("completes a failed run without mutating membership or applied revision", async () => {
    const running = runRow({
      effective_revision: "2",
      status: "running",
      claim_token: claimToken,
      started_at: new Date(claimedAt),
    });
    const failed = runRow({
      effective_revision: "2",
      status: "failed",
      claim_token: claimToken,
      started_at: new Date(claimedAt),
      completed_at: new Date(completedAt),
      actual_provider_request_count: 1,
      failure_code: "provider-timeout",
    });
    const database = new RecordingSqlDatabase([
      { rows: [profileRow()] },
      { rows: [running] },
      { rows: [failed] },
    ]);
    const repository = new PostgresListingRefreshRunRepository(database);

    const result = await repository.completeRun({
      outcome: "failed",
      runId,
      claimToken,
      expectedEffectiveRevision: 2,
      completedAt,
      actualProviderRequestCount: 1,
      returnedListingCount: 0,
      failureCode: "provider-timeout",
    });

    expect(result).toMatchObject({
      status: "completed",
      run: { status: "failed", failureCode: "provider-timeout" },
    });
    expect(database.queries).toHaveLength(3);
    expect(database.queries[2]?.text).toContain("status = 'failed'");
    expect(
      database.queries.some((query) =>
        query.text.includes("listing_search_memberships"),
      ),
    ).toBe(false);
    expect(
      database.queries.some((query) =>
        query.text.includes("SET applied_revision"),
      ),
    ).toBe(false);
  });

  it("rejects an invalid claim before opening a transaction", async () => {
    const database = new RecordingSqlDatabase([]);
    const repository = new PostgresListingRefreshRunRepository(database);

    await expect(
      repository.claimLatestRun({
        profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        signaledRunId: null,
        claimToken: "not-a-uuid",
        claimedAt,
      }),
    ).rejects.toThrow("Listing refresh persistence input was invalid");
    expect(database.transactionCount).toBe(0);
  });
});

const runId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const claimToken = "0198c7d2-7668-7775-b0fc-b789690a60c3";
const requestedAt = "2026-09-08T15:00:00.000Z";
const claimedAt = "2026-09-08T15:01:00.000Z";
const completedAt = "2026-09-08T15:02:00.000Z";

interface RecordedQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  transactionCount = 0;

  constructor(private readonly responses: SqlQueryResult[]) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function profileRow(): Record<string, unknown> {
  return {
    revision: "2",
    applied_revision: "1",
    criteria: defaultListingSearchCriteria,
  };
}

function runRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const plan = createListingRefreshRequestPlan(defaultListingSearchCriteria);
  return {
    run_id: runId,
    profile_key: "primary",
    requested_revision: "2",
    effective_revision: null,
    trigger_reason: "criteria-change",
    status: "queued",
    claim_token: null,
    requested_at: new Date(requestedAt),
    started_at: null,
    completed_at: null,
    selected_markets: plan.selectedMarkets,
    selected_market_count: plan.selectedMarketCount,
    planned_provider_request_count: plan.plannedProviderRequestCount,
    actual_provider_request_count: 0,
    returned_listing_count: 0,
    published_current_count: 0,
    failure_code: null,
    superseded_by_run_id: null,
    ...overrides,
  };
}
