import { describe, expect, it } from "vitest";

import type {
  ListingAlertNotificationPort,
  ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import { FakeListingAlertStateRepository } from "@chaoran-property-intelligence/application";
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
      "repository:create",
      "repository:legacy-initialize",
      "source:rentcast-secret",
      "notifications:telegram-secret:123456789",
      "source:fetch",
      "database:close",
    ]);
    expect(database.queries).toEqual([]);
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

  it("closes the database when legacy initialization fails", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events);
    dependencies.createRepository = () => ({
      ...createRepositoryStub(),
      async initializeLegacyListingAlertState() {
        events.push("repository:legacy-initialize");
        throw new Error("Legacy initialization failed");
      },
    });

    await expect(runProduction(createRuntime(), dependencies)).rejects.toThrow(
      "Legacy initialization failed",
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
    createRepository() {
      events.push("repository:create");
      const repository = new FakeListingAlertStateRepository({
        baselineInitialized: true,
      });
      return {
        isPriceObservationBaselineInitialized: () =>
          repository.isPriceObservationBaselineInitialized(),
        initializePriceObservationBaseline: (entries) =>
          repository.initializePriceObservationBaseline(entries),
        findPriceObservations: (addressKeys) =>
          repository.findPriceObservations(addressKeys),
        saveListingAlertTransitions: (transitions) =>
          repository.saveListingAlertTransitions(transitions),
        findPendingListingAlertEvents: () =>
          repository.findPendingListingAlertEvents(),
        markListingAlertEventsSent: (eventKeys) =>
          repository.markListingAlertEventsSent(eventKeys),
        async initializeLegacyListingAlertState() {
          events.push("repository:legacy-initialize");
        },
      };
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
    createNotifications(options): ListingAlertNotificationPort {
      events.push(`notifications:${options.botToken}:${options.chatId}`);
      return {
        async sendListingAlerts() {
          throw new Error("Unexpected notification");
        },
      };
    },
  };
}

function createRepositoryStub() {
  const repository = new FakeListingAlertStateRepository({
    baselineInitialized: true,
  });
  return {
    isPriceObservationBaselineInitialized: () =>
      repository.isPriceObservationBaselineInitialized(),
    initializePriceObservationBaseline: (entries: Parameters<
      typeof repository.initializePriceObservationBaseline
    >[0]) => repository.initializePriceObservationBaseline(entries),
    findPriceObservations: (addressKeys: Parameters<
      typeof repository.findPriceObservations
    >[0]) => repository.findPriceObservations(addressKeys),
    saveListingAlertTransitions: (transitions: Parameters<
      typeof repository.saveListingAlertTransitions
    >[0]) => repository.saveListingAlertTransitions(transitions),
    findPendingListingAlertEvents: () =>
      repository.findPendingListingAlertEvents(),
    markListingAlertEventsSent: (eventKeys: Parameters<
      typeof repository.markListingAlertEventsSent
    >[0]) => repository.markListingAlertEventsSent(eventKeys),
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
