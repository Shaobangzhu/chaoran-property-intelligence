import { describe, expect, it, vi } from "vitest";

import {
  createListingKey,
  FakeListingAlertStateRepository,
  type ListingPriceObservation,
  type ListingRefreshRun,
  type ListingRefreshRunRepositoryPort,
  type ListingSearchProfile,
  type QueueListingRefreshInput,
} from "@chaoran-property-intelligence/application";
import {
  createListingAddressKey,
  defaultListingSearchCriteria,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";
import {
  RentCastSaleListingsClient,
  type RentCastSaleListing,
} from "@chaoran-property-intelligence/rentcast";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import { RentCastListingSource } from "./rentCastListingSource.js";
import {
  runProduction,
  type ProductionDependencies,
} from "./runProduction.js";

const runId = "0198c7d2-7668-7775-b0fc-b789690a6011";
const claimToken = "0198c7d2-7668-7775-b0fc-b789690a6012";
const observedAt = "2026-09-10T15:00:00.000Z";

describe("listing refresh production workflow integration", () => {
  it("delivers and commits a tracked below-floor price drop through real adapters", async () => {
    const previous = createNormalizedListing();
    const alertRepository = new IntegrationAlertRepository(
      createObservation(previous),
    );
    const profile = createProfile();
    const runRepository = new PublishingRunRepository(
      profile,
      alertRepository,
      createRun({ triggerReason: "scheduled" }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin === "https://api.rentcast.io") {
        return Response.json(
          [
            createRentCastListing({
              price: 770000,
              lastSeenDate: "2026-09-10T12:00:00.000Z",
            }),
          ],
          { headers: { "X-Total-Count": "1" } },
        );
      }
      if (url.origin === "https://api.telegram.org") {
        return Response.json({ ok: true, result: {} });
      }
      throw new Error("Unexpected HTTP origin");
    });

    await runProduction(
      createRuntime(fetch),
      createDependencies(profile, alertRepository, runRepository),
    );

    expect(runRepository.completion).toMatchObject({
      outcome: "succeeded",
      actualProviderRequestCount: 1,
      returnedListingCount: 1,
      publishedCurrentCount: 0,
      candidates: [
        {
          event: {
            kind: "price-drop",
            previousPrice: 825000,
            currentPrice: 770000,
          },
          currentDisplayEligible: false,
        },
      ],
    });
    expect(alertRepository.events).toMatchObject([
      { kind: "price-drop", status: "sent", currentPrice: 770000 },
    ]);
    expect(
      fetch.mock.calls.filter(
        ([input]) => (input as URL).origin === "https://api.telegram.org",
      ),
    ).toHaveLength(1);
  });

  it("quietly publishes the first complete inventory for a changed revision", async () => {
    const alertRepository = new IntegrationAlertRepository();
    const profile = createProfile({ revision: 2, appliedRevision: 1 });
    const runRepository = new PublishingRunRepository(
      profile,
      alertRepository,
      createRun({ requestedRevision: 2 }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin !== "https://api.rentcast.io") {
        throw new Error("Telegram must not be called for a quiet baseline");
      }
      return Response.json([createRentCastListing()], {
        headers: { "X-Total-Count": "1" },
      });
    });

    await runProduction(
      createRuntime(fetch),
      createDependencies(profile, alertRepository, runRepository),
    );

    expect(runRepository.completion).toMatchObject({
      outcome: "succeeded",
      candidates: [{ event: null, currentDisplayEligible: true }],
      publishedCurrentCount: 1,
    });
    expect(alertRepository.events).toEqual([]);
    expect(alertRepository.observations).toHaveLength(1);
    expect(profile.appliedRevision).toBe(2);
  });

  it("records partial request counts and publishes nothing when a later market fails", async () => {
    const alertRepository = new IntegrationAlertRepository(
      createObservation(createNormalizedListing()),
    );
    const profile = createProfile({
      criteria: {
        ...defaultListingSearchCriteria,
        cities: ["Corona", "Irvine"],
      },
    });
    const runRepository = new PublishingRunRepository(
      profile,
      alertRepository,
      createRun({
        selectedMarkets: profile.criteria.cities,
        selectedMarketCount: 2,
        plannedProviderRequestCount: 2,
      }),
    );
    let providerRequest = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin !== "https://api.rentcast.io") {
        throw new Error("Telegram must not be called after acquisition failure");
      }
      providerRequest += 1;
      if (providerRequest === 2) throw new Error("provider unavailable");
      return Response.json([createRentCastListing()], {
        headers: { "X-Total-Count": "1" },
      });
    });
    const previousObservations = alertRepository.observations;

    await expect(
      runProduction(
        createRuntime(fetch),
        createDependencies(profile, alertRepository, runRepository),
      ),
    ).rejects.toMatchObject({
      failureCode: "refresh-execution-failed",
    });

    expect(runRepository.completion).toMatchObject({
      outcome: "failed",
      actualProviderRequestCount: 2,
      returnedListingCount: 1,
      failureCode: "refresh-execution-failed",
    });
    expect(alertRepository.observations).toEqual(previousObservations);
    expect(alertRepository.events).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

class IntegrationAlertRepository extends FakeListingAlertStateRepository {
  constructor(...observations: ListingPriceObservation[]) {
    super({ baselineInitialized: true, observations });
  }

  async initializeLegacyListingAlertState(): Promise<void> {}
}

class PublishingRunRepository implements ListingRefreshRunRepositoryPort {
  completion: Parameters<ListingRefreshRunRepositoryPort["completeRun"]>[0] | null = null;
  private queued: ListingRefreshRun | null;

  constructor(
    private readonly profile: ListingSearchProfile,
    private readonly alerts: IntegrationAlertRepository,
    queued: ListingRefreshRun,
  ) {
    this.queued = queued;
  }

  async claimLatestRun(
    input: Parameters<ListingRefreshRunRepositoryPort["claimLatestRun"]>[0],
  ) {
    if (this.queued === null) return { status: "no-queued-run" } as const;
    const run = this.queued;
    this.queued = null;
    return {
      status: "claimed" as const,
      claim: {
        claimToken: input.claimToken,
        run: {
          ...run,
          effectiveRevision: this.profile.revision,
          status: "running" as const,
          startedAt: input.claimedAt,
        },
        criteria: this.profile.criteria,
        appliedRevision: this.profile.appliedRevision,
      },
    };
  }

  async completeRun(
    input: Parameters<ListingRefreshRunRepositoryPort["completeRun"]>[0],
  ) {
    this.completion = input;
    if (input.outcome === "succeeded") {
      const previous = await this.alerts.findPriceObservations(
        input.candidates.map((candidate) => candidate.observation.addressKey),
      );
      const previousByAddress = new Map(
        previous.map((observation) => [observation.addressKey, observation]),
      );
      await this.alerts.saveListingAlertTransitions(
        input.candidates.map((candidate) => ({
          listing: candidate.listing,
          observation: candidate.observation,
          event: candidate.event,
          expectedPreviousObservation:
            previousByAddress.get(candidate.observation.addressKey) ?? null,
        })),
      );
      Object.assign(this.profile, {
        appliedRevision: input.expectedEffectiveRevision,
      });
    }
    return {
      status: "completed" as const,
      run: createRun({
        status: input.outcome === "succeeded" ? "succeeded" : "failed",
        effectiveRevision: input.expectedEffectiveRevision,
        startedAt: observedAt,
        completedAt: input.completedAt,
        actualProviderRequestCount: input.actualProviderRequestCount,
        returnedListingCount: input.returnedListingCount,
        publishedCurrentCount:
          input.outcome === "succeeded" ? input.publishedCurrentCount : 0,
        failureCode: input.outcome === "failed" ? input.failureCode : null,
      }),
    };
  }

  async queueRun(
    _input: QueueListingRefreshInput,
  ): Promise<ListingRefreshRun> {
    throw new Error("Unexpected scheduled queue");
  }

  async findLatestRun() {
    return this.queued;
  }
}

function createDependencies(
  profile: ListingSearchProfile,
  alertRepository: IntegrationAlertRepository,
  runRepository: PublishingRunRepository,
): ProductionDependencies {
  const database = new RecordingSqlDatabase();
  return {
    createDatabase: () => database,
    runMigrations: async () => {},
    createRepository: () => alertRepository,
    createRefreshRunRepository: () => runRepository,
    createSearchProfileQuery: () => ({
      findPrimaryProfile: async () => profile,
    }),
    createSource: (options) =>
      new RentCastListingSource({
        client: new RentCastSaleListingsClient({
          apiKey: options.apiKey,
          fetch: options.fetch,
        }),
        searchCriteria: options.searchCriteria,
        searchAreas: options.searchAreas,
        now: options.now,
        onProviderRequest: options.onProviderRequest,
        onProviderResponse: options.onProviderResponse,
      }),
    createNotifications: (options) => new TelegramBotClient(options),
  };
}

function createRuntime(fetch: typeof globalThis.fetch) {
  return {
    environment: {
      DATABASE_URL: "postgresql://database.example/app",
      RENTCAST_API_KEY: "rentcast-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_CHAT_ID: "123456789",
      LISTING_REFRESH_RUN_ID: runId,
    },
    fetch,
    now: () => new Date(observedAt),
    createId: () => claimToken,
  };
}

function createProfile(
  overrides: Partial<ListingSearchProfile> = {},
): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: {
      ...defaultListingSearchCriteria,
      cities: ["Corona"],
    },
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
    runId,
    profileKey: "primary",
    requestedRevision: 1,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt: observedAt,
    startedAt: null,
    completedAt: null,
    selectedMarkets: ["Corona"],
    selectedMarketCount: 1,
    plannedProviderRequestCount: 1,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
    ...overrides,
  };
}

function createObservation(
  listing: RentCastNormalizedListing,
): ListingPriceObservation {
  return {
    addressKey: createListingAddressKey(listing),
    listingKey: createListingKey(listing),
    sourceListingId: listing.sourceListingId,
    latestPrice: listing.price,
    latestListedDate: listing.listedDate,
    latestLastSeenDate: listing.lastSeenDate,
    comparisonReady: true,
    observedAt: "2026-09-09T15:00:00.000Z",
  };
}

function createNormalizedListing(
  overrides: Partial<RentCastNormalizedListing> = {},
): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "rentcast-3420",
    mlsName: "CRMLS",
    mlsNumber: "PW26181310",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    addressLine1: "3420 New York Dr",
    addressLine2: null,
    city: "Corona",
    state: "CA",
    zipCode: "92882",
    latitude: 33.8753,
    longitude: -117.5664,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825000,
    status: "Active",
    listedDate: "2026-08-19T00:00:00.000Z",
    lastSeenDate: "2026-09-09T12:00:00.000Z",
    firstDiscoveredAt: "2026-08-19T13:00:00.000Z",
    ...overrides,
  };
}

function createRentCastListing(
  overrides: Partial<RentCastSaleListing> = {},
): RentCastSaleListing {
  const listing = createNormalizedListing();
  return {
    id: listing.sourceListingId,
    formattedAddress: listing.formattedAddress,
    addressLine1: listing.addressLine1,
    addressLine2: listing.addressLine2,
    city: listing.city,
    state: listing.state,
    zipCode: listing.zipCode,
    latitude: listing.latitude,
    longitude: listing.longitude,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    status: listing.status,
    price: listing.price,
    listedDate: listing.listedDate,
    lastSeenDate: listing.lastSeenDate,
    mlsName: listing.mlsName,
    mlsNumber: listing.mlsNumber,
    ...overrides,
  };
}

class RecordingSqlDatabase implements SqlDatabase {
  async query(): Promise<SqlQueryResult> {
    throw new Error("Unexpected direct database query");
  }

  async transaction<T>(
    _operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    throw new Error("Unexpected direct database transaction");
  }

  async close(): Promise<void> {}
}
