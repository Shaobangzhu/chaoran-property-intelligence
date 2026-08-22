import { describe, expect, it } from "vitest";

import { inspectPriceAlertState } from "./inspectPriceAlertState.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("inspectPriceAlertState", () => {
  it("reports an untouched database without querying missing tables", async () => {
    const database = new FakeSqlDatabase([
      {
        rows: [
          {
            state_table_exists: false,
            migrations_table_exists: false,
            observations_table_exists: false,
            events_table_exists: false,
          },
        ],
      },
    ]);

    await expect(inspectPriceAlertState(database)).resolves.toEqual({
      schemaReady: false,
      migrationApplied: false,
      baselineInitialized: false,
      priceObservations: 0,
      pendingEvents: 0,
      sentEvents: 0,
    });
    expect(database.queries).toHaveLength(1);
  });

  it("reports a recorded migration with incomplete tables as inconsistent", async () => {
    const database = new FakeSqlDatabase([
      {
        rows: [
          {
            state_table_exists: true,
            migrations_table_exists: true,
            observations_table_exists: false,
            events_table_exists: false,
          },
        ],
      },
      { rows: [{ migration_applied: true }] },
    ]);

    await expect(inspectPriceAlertState(database)).resolves.toEqual({
      schemaReady: false,
      migrationApplied: true,
      baselineInitialized: false,
      priceObservations: 0,
      pendingEvents: 0,
      sentEvents: 0,
    });
    expect(database.queries).toHaveLength(2);
  });

  it("returns only migration, baseline, and event aggregates", async () => {
    const database = new FakeSqlDatabase([
      {
        rows: [
          {
            state_table_exists: true,
            migrations_table_exists: true,
            observations_table_exists: true,
            events_table_exists: true,
          },
        ],
      },
      { rows: [{ migration_applied: true }] },
      {
        rows: [
          {
            baseline_initialized: true,
            price_observations: 28,
            pending_events: 1,
            sent_events: 4,
          },
        ],
      },
    ]);

    await expect(inspectPriceAlertState(database)).resolves.toEqual({
      schemaReady: true,
      migrationApplied: true,
      baselineInitialized: true,
      priceObservations: 28,
      pendingEvents: 1,
      sentEvents: 4,
    });
    expect(database.queries[1]?.parameters).toEqual([
      "006_create_listing_alert_state",
    ]);
    expect(database.queries[2]?.parameters).toEqual([
      "price_observation_baseline_initialized",
    ]);
    expect(database.queries[2]?.text).not.toContain("formatted_address");
    expect(database.queries[2]?.text).not.toContain("previous_price");
    expect(database.queries[2]?.text).not.toContain("current_price");
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class FakeSqlDatabase implements SqlDatabase {
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
