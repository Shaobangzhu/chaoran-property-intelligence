import { describe, expect, it, vi } from "vitest";

import {
  createListingKey,
  FakeListingAlertStateRepository,
  type ListingSearchProfile,
  type ListingPriceObservation,
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

import {
  RentCastListingCoverageExceededError,
  RentCastListingSource,
} from "./rentCastListingSource.js";
import {
  runProduction,
  type ProductionDependencies,
} from "./runProduction.js";

describe("listing alert production workflow integration", () => {
  it("delivers and commits a tracked below-floor price drop through the real adapters", async () => {
    const steps: string[] = [];
    const previousListing = createNormalizedListing();
    const repository = new IntegrationListingAlertRepository(
      steps,
      createObservation(previousListing),
    );
    const database = new RecordingSqlDatabase(steps);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin === "https://api.rentcast.io") {
        steps.push("rentcast:request");
        expect(url.searchParams.get("price")).toBe("*:850000");
        expect(url.searchParams.get("limit")).toBe("500");
        expect(url.searchParams.get("includeTotalCount")).toBe("true");
        return Response.json(
          [
            createRentCastListing({
              price: 770000,
              lastSeenDate: "2026-08-22T12:00:00.000Z",
            }),
            createRentCastListing({
              id: "rentcast-chino",
              formattedAddress: "456 Oak Ave, Chino, CA 91710",
              addressLine1: "456 Oak Ave",
              city: "Chino",
              zipCode: "91710",
              price: 760000,
            }),
          ],
          { headers: { "X-Total-Count": "2" } },
        );
      }
      if (url.origin === "https://api.telegram.org") {
        steps.push("telegram:request");
        return Response.json({ ok: true, result: {} });
      }
      throw new Error(`Unexpected HTTP request: ${url.origin}`);
    });
    const dependencies: ProductionDependencies = {
      createDatabase() {
        steps.push("database:create");
        return database;
      },
      async runMigrations() {
        steps.push("database:migrate");
      },
      createSearchProfileQuery() {
        steps.push("profile:create");
        return {
          async findPrimaryProfile() {
            steps.push("profile:load");
            return createSearchProfile();
          },
        };
      },
      createRepository() {
        steps.push("repository:create");
        return repository;
      },
      createSource(options) {
        steps.push("source:create");
        return new RentCastListingSource({
          client: new RentCastSaleListingsClient({
            apiKey: options.apiKey,
            fetch: options.fetch,
          }),
          searchCriteria: options.searchCriteria,
          now: options.now,
        });
      },
      createNotifications(options) {
        steps.push("notifications:create");
        return new TelegramBotClient(options);
      },
    };

    await runProduction(
      {
        environment: {
          DATABASE_URL: "postgresql://database.example/app",
          RENTCAST_API_KEY: "rentcast-secret",
          TELEGRAM_BOT_TOKEN: "telegram-secret",
          TELEGRAM_CHAT_ID: "123456789",
        },
        fetch,
        now: () => new Date("2026-08-22T15:00:00.000Z"),
      },
      dependencies,
    );

    expect(steps).toEqual([
      "database:create",
      "database:migrate",
      "profile:create",
      "profile:load",
      "repository:create",
      "repository:legacy-initialize",
      "source:create",
      "notifications:create",
      "rentcast:request",
      "telegram:request",
      "database:close",
    ]);
    expect(repository.events).toMatchObject([
      {
        kind: "price-drop",
        previousPrice: 825000,
        currentPrice: 770000,
        status: "sent",
      },
    ]);
    expect(repository.observations).toMatchObject([
      {
        latestPrice: 770000,
        comparisonReady: true,
      },
    ]);
    expect(repository.listingSnapshots).toHaveLength(1);
    expect(repository.listingSnapshots[0]?.price).toBe(770000);

    const telegramCall = fetch.mock.calls.find(
      ([input]) => (input as URL).origin === "https://api.telegram.org",
    );
    expect(telegramCall).toBeDefined();
    const telegramBody = JSON.parse(
      String(telegramCall?.[1]?.body),
    ) as Record<string, unknown>;
    expect(telegramBody).toEqual({
      chat_id: "123456789",
      text: [
        "PRICE DROP",
        "",
        "3420 New York Dr, Corona, CA 92882",
        "$825,000 -> $770,000",
        "Down $55,000 (6.7%)",
      ].join("\n"),
    });
  });

  it("fails the coverage gate before listing state or Telegram changes", async () => {
    const steps: string[] = [];
    const repository = new IntegrationListingAlertRepository(
      steps,
      createObservation(createNormalizedListing()),
    );
    const database = new RecordingSqlDatabase(steps);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin !== "https://api.rentcast.io") {
        throw new Error(`Unexpected HTTP request: ${url.origin}`);
      }
      steps.push("rentcast:request");
      return Response.json([createRentCastListing()], {
        headers: { "X-Total-Count": "501" },
      });
    });
    const dependencies: ProductionDependencies = {
      createDatabase() {
        return database;
      },
      async runMigrations() {},
      createSearchProfileQuery() {
        return { findPrimaryProfile: async () => createSearchProfile() };
      },
      createRepository() {
        return repository;
      },
      createSource(options) {
        return new RentCastListingSource({
          client: new RentCastSaleListingsClient({
            apiKey: options.apiKey,
            fetch: options.fetch,
          }),
          searchCriteria: options.searchCriteria,
          now: options.now,
        });
      },
      createNotifications(options) {
        return new TelegramBotClient(options);
      },
    };

    await expect(
      runProduction(
        {
          environment: {
            DATABASE_URL: "postgresql://database.example/app",
            RENTCAST_API_KEY: "rentcast-secret",
            TELEGRAM_BOT_TOKEN: "telegram-secret",
            TELEGRAM_CHAT_ID: "123456789",
          },
          fetch,
          now: () => new Date("2026-08-22T15:00:00.000Z"),
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(RentCastListingCoverageExceededError);

    expect(repository.calls).toEqual([]);
    expect(repository.events).toHaveLength(0);
    expect(repository.listingSnapshots).toHaveLength(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

function createSearchProfile(): ListingSearchProfile {
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
  };
}

class IntegrationListingAlertRepository extends FakeListingAlertStateRepository {
  constructor(
    private readonly steps: string[],
    observation: ListingPriceObservation,
  ) {
    super({ baselineInitialized: true, observations: [observation] });
  }

  async initializeLegacyListingAlertState(): Promise<void> {
    this.steps.push("repository:legacy-initialize");
  }
}

class RecordingSqlDatabase implements SqlDatabase {
  constructor(private readonly steps: string[]) {}

  async query(): Promise<SqlQueryResult> {
    throw new Error("Unexpected direct database query");
  }

  async transaction<T>(
    _operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    throw new Error("Unexpected direct database transaction");
  }

  async close(): Promise<void> {
    this.steps.push("database:close");
  }
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
    observedAt: "2026-08-21T15:00:00.000Z",
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
    lastSeenDate: "2026-08-21T12:00:00.000Z",
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
