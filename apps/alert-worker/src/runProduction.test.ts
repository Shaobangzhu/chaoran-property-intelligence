import { describe, expect, it } from "vitest";

import type {
  ListingAlertNotificationPort,
  ListingSearchProfile,
  ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import { FakeListingAlertStateRepository } from "@chaoran-property-intelligence/application";
import {
  defaultListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";
import type {
  RentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

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
      "profile:create",
      "profile:load",
      "repository:create",
      "repository:legacy-initialize",
      "source:rentcast-secret:Single Family:850000:4:2.5:radius,zip-91381",
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

  it.each([
    ["one original market", ["Corona"], "radius"],
    [
      "all original markets",
      ["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"],
      "radius",
    ],
    ["Stevenson Ranch only", ["Stevenson Ranch"], "zip-91381"],
    ["mixed markets", ["Stevenson Ranch", "Corona"], "radius,zip-91381"],
  ] as const)(
    "projects provider fields and acquisition areas for %s",
    async (_label, cities, expectedAreas) => {
      const events: string[] = [];
      const database = new FakeSqlDatabase(events);
      const criteria: ListingSearchCriteriaV1 = {
        ...defaultListingSearchCriteria,
        propertyType: "Condo",
        maximumPrice: 1_250_000,
        minimumBedrooms: 0,
        minimumBathrooms: 0,
        cities,
      };

      await runProduction(
        createRuntime(),
        createDependencies(database, events, createProfile({ criteria })),
      );

      expect(
        events.filter((event) => event.startsWith("source:rentcast-secret")),
      ).toEqual([
        `source:rentcast-secret:Condo:1250000:0:0:${expectedAreas}`,
      ]);
      expect(events.filter((event) => event === "source:fetch")).toHaveLength(
        1,
      );
    },
  );

  it("silently baselines an unapplied revision through the production composition", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(
      database,
      events,
      createProfile({ revision: 2, appliedRevision: 1 }),
    );

    await runProduction(createRuntime(), dependencies);

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "profile:create",
      "profile:load",
      "repository:create",
      "repository:legacy-initialize",
      "source:rentcast-secret:Single Family:850000:4:2.5:radius,zip-91381",
      "notifications:telegram-secret:123456789",
      "source:fetch",
      "repository:revision-baseline:2:1:0",
      "database:close",
    ]);
  });

  it("fails closed before source construction when the profile is missing", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events, null);

    await expect(runProduction(createRuntime(), dependencies)).rejects.toThrow(
      "Listing search profile was unavailable",
    );

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "profile:create",
      "profile:load",
      "database:close",
    ]);
  });

  it("fails closed before source construction for a malformed profile", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const malformedProfile = {
      ...createProfile(),
      criteria: {
        ...defaultListingSearchCriteria,
        state: "NV",
      },
    } as unknown as ListingSearchProfile;

    await expect(
      runProduction(
        createRuntime(),
        createDependencies(database, events, malformedProfile),
      ),
    ).rejects.toThrow("Listing search profile contract was invalid");

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "profile:create",
      "profile:load",
      "database:close",
    ]);
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
  profile: ListingSearchProfile | null = createProfile(),
): ProductionDependencies {
  return {
    createDatabase(connection) {
      events.push(`database:${connection.kind}`);
      return database;
    },
    async runMigrations() {
      events.push("migrate");
    },
    createSearchProfileQuery() {
      events.push("profile:create");
      return {
        async findPrimaryProfile() {
          events.push("profile:load");
          return profile;
        },
      };
    },
    createRepository() {
      events.push("repository:create");
      const repository = new FakeListingAlertStateRepository({
        baselineInitialized: true,
        listingSearchRevision: profile?.revision ?? 1,
        listingSearchAppliedRevision: profile?.appliedRevision ?? 1,
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
        applyListingSearchRevisionBaseline: async (input) => {
          events.push(
            `repository:revision-baseline:${input.expectedRevision}:${input.expectedAppliedRevision}:${input.candidates.length}`,
          );
          return repository.applyListingSearchRevisionBaseline(input);
        },
        async initializeLegacyListingAlertState() {
          events.push("repository:legacy-initialize");
        },
      };
    },
    createSource(options): ListingSourcePort {
      events.push(
        [
          "source",
          options.apiKey,
          options.searchCriteria.propertyType,
          options.searchCriteria.maximumPrice,
          options.searchCriteria.minimumBedrooms,
          options.searchCriteria.minimumBathrooms,
          options.searchAreas.map(describeSearchArea).join(","),
        ].join(":"),
      );
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

function describeSearchArea(area: RentCastSaleListingsSearchArea): string {
  if (area.kind === "radius") {
    return "radius";
  }

  return area.kind === "city" ? `city-${area.city}` : `zip-${area.zipCode}`;
}

function createProfile(
  overrides: Partial<ListingSearchProfile> = {},
): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: defaultListingSearchCriteria,
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-21T19:00:00.000Z",
    ...overrides,
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
    applyListingSearchRevisionBaseline: (input: Parameters<
      typeof repository.applyListingSearchRevisionBaseline
    >[0]) => repository.applyListingSearchRevisionBaseline(input),
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
