import { describe, expect, it } from "vitest";

import type {
  BaselineState,
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import {
  verifyProductionBaseline,
  type BaselineVerificationDependencies,
} from "./verifyProductionBaseline.js";

describe("verifyProductionBaseline", () => {
  it("inspects the production database and always closes it", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const expected: BaselineState = {
      schemaReady: true,
      migrationApplied: true,
      baselineInitialized: true,
      baselineListings: 4,
      pendingListings: 0,
      sentListings: 0,
    };
    const dependencies = createDependencies(database, events, expected);

    await expect(
      verifyProductionBaseline(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        dependencies,
      ),
    ).resolves.toEqual(expected);
    expect(events).toEqual(["database:connection-string", "inspect", "close"]);
  });

  it("closes the database when inspection fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events, {
      schemaReady: false,
      migrationApplied: false,
      baselineInitialized: false,
      baselineListings: 0,
      pendingListings: 0,
      sentListings: 0,
    });
    dependencies.inspectBaseline = async () => {
      events.push("inspect");
      throw new Error("Inspection failed");
    };

    await expect(
      verifyProductionBaseline(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Inspection failed");
    expect(events).toEqual(["database:connection-string", "inspect", "close"]);
  });
});

function createDependencies(
  database: SqlDatabase,
  events: string[],
  state: BaselineState,
): BaselineVerificationDependencies {
  return {
    createDatabase(connection) {
      events.push(`database:${connection.kind}`);
      return database;
    },
    async inspectBaseline() {
      events.push("inspect");
      return state;
    },
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
