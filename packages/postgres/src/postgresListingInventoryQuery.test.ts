import { describe, expect, it } from "vitest";

import { PostgresListingInventoryQuery } from "./postgresListingInventoryQuery.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingInventoryQuery", () => {
  it("returns only authoritative current membership with applied freshness", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [
          {
            applied_revision: "3",
            completed_at: new Date("2026-09-08T15:05:00.000Z"),
          },
        ],
      },
      { rows: [inventoryRow()] },
    ]);
    const query = new PostgresListingInventoryQuery(database);

    const result = await query.findCurrentInventory();

    expect(result).toMatchObject({
      profileKey: "primary",
      appliedRevision: 3,
      refreshedAt: "2026-09-08T15:05:00.000Z",
      items: [
        {
          listingId,
          acquisitionEligible: true,
          currentDisplayEligible: true,
          membership: { lifecycleState: "current" },
          listing: { source: "rentcast", sourceListingId: "rentcast-1" },
        },
      ],
    });
    expect(database.queries[1]?.text).toContain(
      "m.lifecycle_state = 'current'",
    );
    expect(database.queries[1]?.parameters).toEqual(["primary", 3]);
  });

  it("returns null before the first successful membership publication", async () => {
    const query = new PostgresListingInventoryQuery(
      new RecordingSqlDatabase([{ rows: [] }]),
    );
    await expect(query.findCurrentInventory()).resolves.toBeNull();
  });

  it("uses bounded keyset pagination for historical lifecycle reads", async () => {
    const rows = [
      inventoryRow({
        lifecycle_state: "missing",
        consecutive_complete_run_absence_count: 1,
      }),
      inventoryRow({
        listing_id: secondListingId,
        source_listing_id: "rentcast-2",
        deduplication_key: "rentcast:rentcast-2",
        lifecycle_state: "out_of_scope",
      }),
    ];
    const database = new RecordingSqlDatabase([{ rows }]);
    const query = new PostgresListingInventoryQuery(database);

    const result = await query.findListingHistory({
      lifecycleStates: ["missing", "out_of_scope"],
      cursor: null,
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(database.queries[0]?.text).toContain(
      "ORDER BY m.lifecycle_changed_at DESC, m.listing_id ASC",
    );
    expect(database.queries[0]?.parameters).toEqual([
      "primary",
      ["missing", "out_of_scope"],
      null,
      null,
      2,
    ]);
  });

  it("rejects malformed history cursors without querying PostgreSQL", async () => {
    const database = new RecordingSqlDatabase([]);
    const query = new PostgresListingInventoryQuery(database);
    await expect(
      query.findListingHistory({
        lifecycleStates: ["inactive"],
        cursor: "not-json-base64",
        limit: 25,
      }),
    ).rejects.toThrow("Listing history query was invalid");
    expect(database.queries).toHaveLength(0);
  });
});

const listingId = "0198c7d2-7668-7775-b0fc-b789690a6101";
const secondListingId = "0198c7d2-7668-7775-b0fc-b789690a6102";
const runId = "0198c7d2-7668-7775-b0fc-b789690a6103";

function inventoryRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    listing_id: listingId,
    deduplication_key: "rentcast:rentcast-1",
    source: "rentcast",
    source_listing_id: "rentcast-1",
    mls_name: "CRMLS",
    mls_number: "PW26181310",
    formatted_address: "3420 New York Dr, Corona, CA 92882",
    address_line_1: "3420 New York Dr",
    address_line_2: null,
    city: "Corona",
    state: "CA",
    zip_code: "92882",
    latitude: 33.9,
    longitude: -117.5,
    property_type: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 849900,
    status: "Active",
    listed_date: "2026-09-01",
    last_seen_date: "2026-09-08",
    first_discovered_at: "2026-09-08T15:00:00.000Z",
    profile_key: "primary",
    applied_revision: "3",
    last_successful_run_id: runId,
    lifecycle_state: "current",
    first_matched_at: new Date("2026-09-08T15:00:00.000Z"),
    last_matched_at: new Date("2026-09-08T15:00:00.000Z"),
    last_server_observed_at: new Date("2026-09-08T15:00:00.000Z"),
    consecutive_complete_run_absence_count: 0,
    inactive_at: null,
    explicit_provider_status: null,
    explicit_provider_status_observed_at: null,
    lifecycle_changed_at: new Date("2026-09-08T15:05:00.000Z"),
    ...overrides,
  };
}

interface RecordedQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];

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
    return operation(this);
  }

  async close(): Promise<void> {}
}
