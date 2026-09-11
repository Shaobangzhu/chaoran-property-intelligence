import { describe, expect, it } from "vitest";

import { LISTING_RETENTION_DEFAULTS } from "@chaoran-property-intelligence/application";

import { PostgresListingRetentionRepository } from "./postgresListingRetentionRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingRetentionRepository", () => {
  it("previews a deterministic bounded candidate batch without mutation", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [
          candidateRow("search-run", runId),
          candidateRow("provider-listing", listingId),
        ],
      },
    ]);
    const repository = new PostgresListingRetentionRepository(database);

    const result = await repository.listCandidates(retentionInput);

    expect(result).toEqual([
      {
        recordKind: "search-run",
        recordKey: runId,
        retainedThrough,
      },
      {
        recordKind: "provider-listing",
        recordKey: listingId,
        retainedThrough,
      },
    ]);
    expect(database.transactionCount).toBe(0);
    expect(database.queries[0]?.text).toContain("LIMIT $7");
    expect(database.queries[0]?.text).toContain(
      "ORDER BY retained_through ASC, record_kind ASC, record_key ASC",
    );
    expect(database.queries[0]?.parameters.at(-1)).toBe(500);
    expect(database.queries[0]?.text).toContain("l.source = 'rentcast'");
    expect(database.queries[0]?.text).toContain("e.status = 'sent'");
  });

  it("deletes only the approved batch and reports whether more remains", async () => {
    const membershipKey = `primary/${listingId}`;
    const database = new RecordingSqlDatabase([
      {
        rows: [
          candidateRow("search-membership", membershipKey),
          candidateRow("alert-event", eventId),
        ],
      },
      { rows: [{ listing_id: listingId }] },
      { rows: [{ id: eventId }] },
      { rows: [candidateRow("search-run", runId)] },
    ]);
    const repository = new PostgresListingRetentionRepository(database);

    const report = await repository.execute({
      ...retentionInput,
      expectedCandidates: {
        searchRuns: 0,
        searchMemberships: 1,
        providerListings: 0,
        alertEvents: 1,
        total: 2,
      },
    });

    expect(report).toMatchObject({
      mode: "execute",
      candidates: { searchMemberships: 1, alertEvents: 1, total: 2 },
      deleted: { searchMemberships: 1, alertEvents: 1, total: 2 },
      hasMore: true,
    });
    expect(database.transactionCount).toBe(1);
    expect(database.queries[1]?.text).toContain(
      "DELETE FROM listing_search_memberships",
    );
    expect(database.queries[1]?.text).toContain(
      "lifecycle_state IN ('inactive', 'out_of_scope')",
    );
    expect(database.queries[2]?.text).toContain(
      "DELETE FROM listing_alert_events",
    );
    expect(database.queries[2]?.text).toContain(
      "observed_at + make_interval",
    );
    expect(database.queries[3]?.parameters.at(-1)).toBe(1);
  });

  it("fails closed when candidates changed after preview", async () => {
    const database = new RecordingSqlDatabase([{ rows: [] }]);
    const repository = new PostgresListingRetentionRepository(database);

    await expect(
      repository.execute({
        ...retentionInput,
        expectedCandidates: {
          searchRuns: 1,
          searchMemberships: 0,
          providerListings: 0,
          alertEvents: 0,
          total: 1,
        },
      }),
    ).rejects.toThrow("changed after the approved preview");
    expect(database.queries).toHaveLength(1);
  });

  it("rechecks every cutoff and protected reference at deletion time", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [
          candidateRow("search-membership", `primary/${listingId}`),
          candidateRow("alert-event", eventId),
          candidateRow("search-run", runId),
          candidateRow("provider-listing", providerListingId),
        ],
      },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresListingRetentionRepository(database);

    await repository.execute({
      ...retentionInput,
      expectedCandidates: {
        searchRuns: 1,
        searchMemberships: 1,
        providerListings: 1,
        alertEvents: 1,
        total: 4,
      },
    });

    expect(database.queries[1]?.text).toContain("lifecycle_changed_at");
    expect(database.queries[2]?.text).toContain("observed_at");
    expect(database.queries[3]?.text).toContain("completed_at");
    expect(database.queries[3]?.text).toContain("last_successful_run_id");
    expect(database.queries[4]?.text).toContain("l.updated_at");
    expect(database.queries[4]?.text).toContain("listing_price_observations");
    expect(database.queries[4]?.text).toContain("listing_alert_events");
    expect(database.queries[4]?.text).toContain("current_showing_list_draft");
  });
});

const asOf = "2026-09-08T15:00:00.000Z";
const retainedThrough = "2026-09-01T15:00:00.000Z";
const runId = "0198c7d2-7668-7775-b0fc-b789690a6201";
const listingId = "0198c7d2-7668-7775-b0fc-b789690a6202";
const eventId = "0198c7d2-7668-7775-b0fc-b789690a6203";
const providerListingId = "0198c7d2-7668-7775-b0fc-b789690a6204";
const retentionInput = {
  asOf,
  policy: LISTING_RETENTION_DEFAULTS,
};

function candidateRow(
  recordKind: string,
  recordKey: string,
): Record<string, unknown> {
  return {
    record_kind: recordKind,
    record_key: recordKey,
    retained_through: new Date(retainedThrough),
  };
}

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
