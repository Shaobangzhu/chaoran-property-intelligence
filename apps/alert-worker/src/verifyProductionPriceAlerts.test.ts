import { describe, expect, it } from "vitest";

import type {
  PriceAlertState,
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import {
  verifyProductionPriceAlerts,
  type PriceAlertVerificationDependencies,
} from "./verifyProductionPriceAlerts.js";

describe("verifyProductionPriceAlerts", () => {
  it("inspects aggregate state using database configuration only", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const expected = createPriceAlertState();

    await expect(
      verifyProductionPriceAlerts(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        createDependencies(database, events, expected),
      ),
    ).resolves.toEqual(expected);
    expect(events).toEqual([
      "database:connection-string",
      "inspect",
      "close",
    ]);
  });

  it("closes the database when inspection fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(
      database,
      events,
      createPriceAlertState(),
    );
    dependencies.inspectPriceAlerts = async () => {
      events.push("inspect");
      throw new Error("Inspection failed");
    };

    await expect(
      verifyProductionPriceAlerts(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Inspection failed");
    expect(events).toEqual([
      "database:connection-string",
      "inspect",
      "close",
    ]);
  });
});

function createDependencies(
  database: SqlDatabase,
  events: string[],
  state: PriceAlertState,
): PriceAlertVerificationDependencies {
  return {
    createDatabase(connection) {
      events.push(`database:${connection.kind}`);
      return database;
    },
    async inspectPriceAlerts() {
      events.push("inspect");
      return state;
    },
  };
}

function createPriceAlertState(): PriceAlertState {
  return {
    schemaReady: true,
    migrationApplied: true,
    baselineInitialized: true,
    priceObservations: 28,
    pendingEvents: 0,
    sentEvents: 0,
  };
}

class FakeSqlDatabase implements SqlDatabase {
  constructor(private readonly events: string[]) {}

  async query(): Promise<SqlQueryResult> {
    return { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {
    this.events.push("close");
  }
}
