import { describe, expect, it } from "vitest";

import { inspectBaselineState } from "./inspectBaselineState.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("inspectBaselineState", () => {
  it("reports an untouched database without querying missing tables", async () => {
    const database = new FakeSqlDatabase([
      {
        rows: [
          {
            state_table_exists: false,
            listings_table_exists: false,
            migrations_table_exists: false,
          },
        ],
      },
    ]);

    await expect(inspectBaselineState(database)).resolves.toEqual({
      schemaReady: false,
      migrationApplied: false,
      baselineInitialized: false,
      baselineListings: 0,
      pendingListings: 0,
      sentListings: 0,
    });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toContain("to_regclass");
  });

  it("returns only migration, baseline, and status aggregates", async () => {
    const database = new FakeSqlDatabase([
      {
        rows: [
          {
            state_table_exists: true,
            listings_table_exists: true,
            migrations_table_exists: true,
          },
        ],
      },
      {
        rows: [
          {
            baseline_initialized: true,
            migration_applied: true,
            baseline_listings: 7,
            pending_listings: 0,
            sent_listings: 0,
          },
        ],
      },
    ]);

    await expect(inspectBaselineState(database)).resolves.toEqual({
      schemaReady: true,
      migrationApplied: true,
      baselineInitialized: true,
      baselineListings: 7,
      pendingListings: 0,
      sentListings: 0,
    });
    expect(database.queries[1]).toContain("notification_status");
    expect(database.queries[1]).not.toContain("formatted_address");
  });
});

class FakeSqlDatabase implements SqlDatabase {
  readonly queries: string[] = [];

  constructor(private readonly responses: SqlQueryResult[]) {}

  async query(text: string): Promise<SqlQueryResult> {
    this.queries.push(text);
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {}
}
