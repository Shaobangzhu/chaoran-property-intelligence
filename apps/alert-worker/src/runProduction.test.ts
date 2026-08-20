import { describe, expect, it } from "vitest";

import type {
  ListingNotificationPort,
  ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import {
  runProduction,
  type ProductionDependencies,
} from "./runProduction.js";

describe("runProduction", () => {
  it("migrates, executes the use case, and closes the database", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events);

    await runProduction(createRuntime(), dependencies);

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "source:rentcast-secret",
      "notifications:telegram-secret:123456789",
      "source:fetch",
      "database:close",
    ]);
    expect(
      database.queries.some((query) =>
        query.text.includes("INSERT INTO alert_worker_state"),
      ),
    ).toBe(true);
  });

  it("closes the database when migration fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events);
    dependencies.runMigrations = async () => {
      events.push("migrate");
      throw new Error("Migration failed");
    };

    await expect(runProduction(createRuntime(), dependencies)).rejects.toThrow(
      "Migration failed",
    );

    expect(events.at(-1)).toBe("database:close");
  });
});

function createRuntime() {
  return {
    environment: {
      DATABASE_URL: "postgresql://database.example/app",
      RENTCAST_API_KEY: "rentcast-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_CHAT_ID: "123456789",
    },
    fetch: (async () => {
      throw new Error("Unexpected HTTP request");
    }) as typeof fetch,
    now: () => new Date("2026-08-19T17:00:00.000Z"),
  };
}

function createDependencies(
  database: SqlDatabase,
  events: string[],
): ProductionDependencies {
  return {
    createDatabase(connection) {
      events.push(`database:${connection.kind}`);
      return database;
    },
    async runMigrations() {
      events.push("migrate");
    },
    createSource(options): ListingSourcePort {
      events.push(`source:${options.apiKey}`);
      return {
        async getActiveSaleListings() {
          events.push("source:fetch");
          return [];
        },
      };
    },
    createNotifications(options): ListingNotificationPort {
      events.push(`notifications:${options.botToken}:${options.chatId}`);
      return {
        async sendListingAddresses() {
          throw new Error("Unexpected notification");
        },
      };
    },
  };
}

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class FakeSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];

  constructor(private readonly events: string[]) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    return { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {
    this.events.push("database:close");
  }
}
