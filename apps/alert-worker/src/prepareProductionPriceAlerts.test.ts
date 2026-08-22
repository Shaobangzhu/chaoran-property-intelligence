import { describe, expect, it } from "vitest";

import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import {
  prepareProductionPriceAlerts,
  type PriceAlertPreparationDependencies,
} from "./prepareProductionPriceAlerts.js";

describe("prepareProductionPriceAlerts", () => {
  it("migrates and initializes legacy state using database configuration only", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);

    await prepareProductionPriceAlerts(
      {
        environment: {
          DATABASE_URL: "postgresql://database.example/app",
        },
      },
      createDependencies(database, events),
    );

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "repository:create",
      "repository:legacy-initialize",
      "close",
    ]);
  });

  it("closes the database when migration fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events);
    dependencies.runMigrations = async () => {
      events.push("migrate");
      throw new Error("Migration failed");
    };

    await expect(
      prepareProductionPriceAlerts(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Migration failed");
    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "close",
    ]);
  });

  it("closes the database when legacy initialization fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events);
    dependencies.createRepository = () => ({
      async initializeLegacyListingAlertState() {
        events.push("repository:legacy-initialize");
        throw new Error("Legacy initialization failed");
      },
    });

    await expect(
      prepareProductionPriceAlerts(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Legacy initialization failed");
    expect(events.at(-1)).toBe("close");
  });
});

function createDependencies(
  database: SqlDatabase,
  events: string[],
): PriceAlertPreparationDependencies {
  return {
    createDatabase(connection) {
      events.push(`database:${connection.kind}`);
      return database;
    },
    async runMigrations() {
      events.push("migrate");
    },
    createRepository() {
      events.push("repository:create");
      return {
        async initializeLegacyListingAlertState() {
          events.push("repository:legacy-initialize");
        },
      };
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
