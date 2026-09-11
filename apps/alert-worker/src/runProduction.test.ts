import { describe, expect, it } from "vitest";

import {
  FakeListingAlertStateRepository,
  type CompleteListingRefreshRunResult,
  type ListingAlertNotificationPort,
  type ListingRefreshRun,
  type ListingRefreshRunRepositoryPort,
  type ListingSearchProfile,
  type ListingSourcePort,
  type QueueListingRefreshInput,
} from "@chaoran-property-intelligence/application";
import {
  defaultListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";
import type { RentCastSaleListingsSearchArea } from "@chaoran-property-intelligence/rentcast";

import {
  runProduction,
  type ProductionDependencies,
} from "./runProduction.js";

const scheduledRunId = "0198c7d2-7668-7775-b0fc-b789690a6012";
const signaledRunId = "0198c7d2-7668-7775-b0fc-b789690a6013";
const claimedAt = "2026-09-10T15:00:00.000Z";

describe("runProduction", () => {
  it("migrates, creates a scheduled refresh, reconciles, and closes", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const dependencies = createDependencies(database, events, createProfile());

    await runProduction(createRuntime(), dependencies);

    expect(events).toEqual([
      "database:connection-string",
      "migrate",
      "repository:create",
      "repository:legacy-initialize",
      "profile:create",
      "run-repository:create",
      "run:claim:none",
      "profile:load",
      "run:queue:scheduled:1:6",
      "run:claim:queued",
      "source:rentcast-secret:Single Family:850000:4:2.5:city-Chino,city-Chino Hills,city-Eastvale,city-Corona,city-Jurupa Valley,zip-91381",
      "source:fetch",
      "run:complete:succeeded:6:0:0",
      "database:close",
    ]);
  });

  it.each([
    ["one market", ["Corona"], "city-Corona"],
    ["Irvine", ["Irvine"], "city-Irvine"],
    [
      "mixed",
      ["Stevenson Ranch", "Corona"],
      "city-Corona,zip-91381",
    ],
  ] as const)(
    "projects criteria and sequential acquisition areas for %s",
    async (_label, cities, expectedAreas) => {
      const events: string[] = [];
      const criteria: ListingSearchCriteriaV1 = {
        ...defaultListingSearchCriteria,
        propertyType: "Condo",
        maximumPrice: 1_250_000,
        minimumBedrooms: 0,
        minimumBathrooms: 0,
        cities,
      };
      const database = new FakeSqlDatabase(events);

      await runProduction(
        createRuntime(),
        createDependencies(database, events, createProfile({ criteria })),
      );

      expect(
        events.filter((event) => event.startsWith("source:rentcast-secret")),
      ).toEqual([
        `source:rentcast-secret:Condo:1250000:0:0:${expectedAreas}`,
      ]);
      expect(events).toContain(
        `run:complete:succeeded:${cities.length}:0:0`,
      );
    },
  );

  it("claims an opaque signaled run without creating scheduled work", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const profile = createProfile({ revision: 2, appliedRevision: 1 });
    const dependencies = createDependencies(
      database,
      events,
      profile,
      createRun({
        runId: signaledRunId,
        requestedRevision: 2,
        selectedMarkets: profile.criteria.cities,
        selectedMarketCount: profile.criteria.cities.length,
        plannedProviderRequestCount: profile.criteria.cities.length,
      }),
    );

    await runProduction(
      createRuntime({ LISTING_REFRESH_RUN_ID: signaledRunId }),
      dependencies,
    );

    expect(events).toContain(`run:claim:${signaledRunId}`);
    expect(events.some((event) => event.startsWith("run:queue"))).toBe(false);
    expect(events.some((event) => event === "profile:load")).toBe(false);
  });

  it("does not construct a source for a stale signaled run", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);

    await runProduction(
      createRuntime({ LISTING_REFRESH_RUN_ID: signaledRunId }),
      createDependencies(database, events, createProfile()),
    );

    expect(events).toContain(`run:claim:${signaledRunId}`);
    expect(events.some((event) => event.startsWith("source:"))).toBe(false);
    expect(events.at(-1)).toBe("database:close");
  });

  it("claims and fails a durable run when provider configuration is unavailable", async () => {
    const events: string[] = [];
    const database = new FakeSqlDatabase(events);
    const profile = createProfile({ revision: 2, appliedRevision: 1 });
    const dependencies = createDependencies(
      database,
      events,
      profile,
      createRun({
        runId: signaledRunId,
        requestedRevision: 2,
        selectedMarkets: profile.criteria.cities,
        selectedMarketCount: profile.criteria.cities.length,
        plannedProviderRequestCount: profile.criteria.cities.length,
      }),
    );

    await expect(
      runProduction(
        createRuntime({
          LISTING_REFRESH_RUN_ID: signaledRunId,
          TELEGRAM_BOT_TOKEN: " ",
        }),
        dependencies,
      ),
    ).rejects.toMatchObject({
      failureCode: "worker-configuration-unavailable",
    });

    expect(events).toContain(`run:claim:${signaledRunId}`);
    expect(events).toContain("run:complete:failed:0:0:0");
    expect(events.some((event) => event.startsWith("source:"))).toBe(false);
    expect(events.at(-1)).toBe("database:close");
  });

  it("closes the database when migration or reconciliation fails", async () => {
    const migrationEvents: string[] = [];
    const migrationDatabase = new FakeSqlDatabase(migrationEvents);
    const migrationDependencies = createDependencies(
      migrationDatabase,
      migrationEvents,
      createProfile(),
    );
    migrationDependencies.runMigrations = async () => {
      migrationEvents.push("migrate");
      throw new Error("Migration failed");
    };
    await expect(
      runProduction(createRuntime(), migrationDependencies),
    ).rejects.toThrow("Migration failed");
    expect(migrationEvents.at(-1)).toBe("database:close");

    const profileEvents: string[] = [];
    const profileDatabase = new FakeSqlDatabase(profileEvents);
    await expect(
      runProduction(
        createRuntime(),
        createDependencies(profileDatabase, profileEvents, null),
      ),
    ).rejects.toMatchObject({ failureCode: "profile-unavailable" });
    expect(profileEvents.at(-1)).toBe("database:close");
  });
});

function createRuntime(
  environmentOverrides: Record<string, string> = {},
) {
  const ids = [
    "0198c7d2-7668-7775-b0fc-b789690a6011",
    scheduledRunId,
    "0198c7d2-7668-7775-b0fc-b789690a6014",
  ];
  return {
    environment: {
      DATABASE_URL: "postgresql://database.example/app",
      RENTCAST_API_KEY: "rentcast-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_CHAT_ID: "123456789",
      ...environmentOverrides,
    },
    fetch: (async () => {
      throw new Error("Unexpected HTTP request");
    }) as typeof fetch,
    now: () => new Date(claimedAt),
    createId: () => ids.shift() ?? scheduledRunId,
  };
}

function createDependencies(
  database: SqlDatabase,
  events: string[],
  profile: ListingSearchProfile | null,
  queuedRun: ListingRefreshRun | null = null,
): ProductionDependencies {
  const runRepository = new FakeRunRepository(events, profile, queuedRun);
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
        async initializeLegacyListingAlertState() {
          events.push("repository:legacy-initialize");
        },
        isPriceObservationBaselineInitialized: () =>
          repository.isPriceObservationBaselineInitialized(),
        initializePriceObservationBaseline: (entries) =>
          repository.initializePriceObservationBaseline(entries),
        findPriceObservations: (keys) =>
          repository.findPriceObservations(keys),
        saveListingAlertTransitions: (transitions) =>
          repository.saveListingAlertTransitions(transitions),
        findPendingListingAlertEvents: () =>
          repository.findPendingListingAlertEvents(),
        markListingAlertEventsSent: (keys) =>
          repository.markListingAlertEventsSent(keys),
      };
    },
    createRefreshRunRepository() {
      events.push("run-repository:create");
      return runRepository;
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
          for (const _area of options.searchAreas) {
            options.onProviderRequest();
            options.onProviderResponse(0);
          }
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

class FakeRunRepository implements ListingRefreshRunRepositoryPort {
  private queuedRun: ListingRefreshRun | null;
  private claimedRun: ListingRefreshRun | null = null;

  constructor(
    private readonly events: string[],
    private readonly profile: ListingSearchProfile | null,
    queuedRun: ListingRefreshRun | null,
  ) {
    this.queuedRun = queuedRun;
  }

  async claimLatestRun(
    input: Parameters<ListingRefreshRunRepositoryPort["claimLatestRun"]>[0],
  ) {
    this.events.push(
      `run:claim:${input.signaledRunId ?? (this.queuedRun === null ? "none" : "queued")}`,
    );
    if (this.queuedRun === null || this.profile === null) {
      return { status: "no-queued-run" } as const;
    }
    const run = this.queuedRun;
    this.queuedRun = null;
    this.claimedRun = {
      ...run,
      status: "running" as const,
      effectiveRevision: this.profile.revision,
      startedAt: input.claimedAt,
    };
    return {
      status: "claimed" as const,
      claim: {
        claimToken: input.claimToken,
        run: this.claimedRun,
        criteria: this.profile.criteria,
        appliedRevision: this.profile.appliedRevision,
      },
    };
  }

  async queueRun(input: QueueListingRefreshInput): Promise<ListingRefreshRun> {
    this.events.push(
      `run:queue:${input.triggerReason}:${input.revision}:${input.plan.plannedProviderRequestCount}`,
    );
    this.queuedRun = createRun({
      runId: input.runId,
      requestedRevision: input.revision,
      requestedAt: input.requestedAt,
      triggerReason: input.triggerReason,
      status: "queued",
      effectiveRevision: null,
      startedAt: null,
      selectedMarkets: input.plan.selectedMarkets,
      selectedMarketCount: input.plan.selectedMarketCount,
      plannedProviderRequestCount: input.plan.plannedProviderRequestCount,
    });
    return this.queuedRun;
  }

  async completeRun(
    input: Parameters<ListingRefreshRunRepositoryPort["completeRun"]>[0],
  ): Promise<CompleteListingRefreshRunResult> {
    if (this.claimedRun === null) {
      throw new Error("Unexpected completion without a claim");
    }
    this.events.push(
      `run:complete:${input.outcome}:${input.actualProviderRequestCount}:${input.returnedListingCount}:${input.outcome === "succeeded" ? input.publishedCurrentCount : 0}`,
    );
    return {
      status: "completed" as const,
      run: {
        ...this.claimedRun,
        status: input.outcome === "succeeded" ? "succeeded" : "failed",
        completedAt: input.completedAt,
        actualProviderRequestCount: input.actualProviderRequestCount,
        returnedListingCount: input.returnedListingCount,
        publishedCurrentCount:
          input.outcome === "succeeded" ? input.publishedCurrentCount : 0,
        failureCode: input.outcome === "failed" ? input.failureCode : null,
      },
    };
  }

  async findLatestRun() {
    return this.queuedRun;
  }
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

function createRun(overrides: Partial<ListingRefreshRun> = {}): ListingRefreshRun {
  return {
    runId: signaledRunId,
    profileKey: "primary",
    requestedRevision: 1,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt: claimedAt,
    startedAt: null,
    completedAt: null,
    selectedMarkets: defaultListingSearchCriteria.cities,
    selectedMarketCount: defaultListingSearchCriteria.cities.length,
    plannedProviderRequestCount: defaultListingSearchCriteria.cities.length,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
    ...overrides,
  };
}

function describeSearchArea(area: RentCastSaleListingsSearchArea): string {
  if (area.kind === "radius") return "radius";
  return area.kind === "city" ? `city-${area.city}` : `zip-${area.zipCode}`;
}

class FakeSqlDatabase implements SqlDatabase {
  constructor(private readonly events: string[]) {}

  async query(): Promise<SqlQueryResult> {
    return { rows: [] };
  }

  async transaction<T>(operation: (connection: SqlConnection) => Promise<T>) {
    return operation(this);
  }

  async close() {
    this.events.push("database:close");
  }
}
