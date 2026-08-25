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
          searchAreas: options.searchAreas,
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
        return {
          findPrimaryProfile: async () =>
            createSearchProfile({ revision: 2, appliedRevision: 1 }),
        };
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
          searchAreas: options.searchAreas,
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

  it("silently baselines a revision before later new-listing and below-floor drop alerts", async () => {
    const steps: string[] = [];
    const widenedCriteria = {
      ...defaultListingSearchCriteria,
      cities: ["Chino", "Corona"] as const,
    };
    let profile = createSearchProfile({
      criteria: widenedCriteria,
      revision: 2,
      appliedRevision: 1,
    });
    let providerCall = 0;
    const repository = new IntegrationListingAlertRepository(
      steps,
      createObservation(createNormalizedListing()),
      { revision: 2, appliedRevision: 1 },
    );
    const database = new RecordingSqlDatabase(steps);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin === "https://api.rentcast.io") {
        providerCall += 1;
        steps.push(`rentcast:request:${providerCall}`);
        const isLaterRun = providerCall > 2;
        const tracked = createRentCastListing({
          price: isLaterRun ? 770000 : 820000,
          lastSeenDate: isLaterRun
            ? "2026-08-23T12:00:00.000Z"
            : "2026-08-22T12:00:00.000Z",
        });
        const widenedInventory = createRentCastListing({
          id: "rentcast-widened",
          formattedAddress: "100 Main St, Chino, CA 91710",
          addressLine1: "100 Main St",
          city: "Chino",
          zipCode: "91710",
          price: 830000,
        });
        const city = url.searchParams.get("city");
        const listings = city === "Chino"
          ? [widenedInventory]
          : [
              tracked,
              ...(isLaterRun
                ? [
                    createRentCastListing({
                      id: "rentcast-later-new",
                      formattedAddress: "300 Main St, Corona, CA 92882",
                      addressLine1: "300 Main St",
                      price: 840000,
                    }),
                  ]
                : []),
            ];
        return Response.json(listings, {
          headers: { "X-Total-Count": String(listings.length) },
        });
      }
      if (url.origin === "https://api.telegram.org") {
        steps.push("telegram:request");
        return Response.json({ ok: true, result: {} });
      }
      throw new Error(`Unexpected HTTP request: ${url.origin}`);
    });
    const dependencies: ProductionDependencies = {
      createDatabase: () => database,
      runMigrations: async () => {},
      createSearchProfileQuery: () => ({
        findPrimaryProfile: async () => profile,
      }),
      createRepository: () => repository,
      createSource: (options) =>
        new RentCastListingSource({
          client: new RentCastSaleListingsClient({
            apiKey: options.apiKey,
            fetch: options.fetch,
          }),
          searchCriteria: options.searchCriteria,
          searchAreas: options.searchAreas,
          now: options.now,
        }),
      createNotifications: (options) => new TelegramBotClient(options),
    };
    const runtime = {
      environment: {
        DATABASE_URL: "postgresql://database.example/app",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      },
      fetch,
      now: () => new Date("2026-08-22T15:00:00.000Z"),
    };

    await runProduction(runtime, dependencies);

    expect(repository.listingSearchRevisions.appliedRevision).toBe(2);
    expect(repository.observations).toHaveLength(2);
    expect(repository.events).toEqual([]);
    expect(steps.filter((step) => step === "telegram:request")).toHaveLength(0);

    profile = createSearchProfile({
      criteria: widenedCriteria,
      revision: 2,
      appliedRevision: 2,
    });
    await runProduction(
      { ...runtime, now: () => new Date("2026-08-23T15:00:00.000Z") },
      dependencies,
    );

    expect(repository.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "price-drop",
          previousPrice: 820000,
          currentPrice: 770000,
          status: "sent",
        }),
        expect.objectContaining({
          kind: "new-listing",
          previousPrice: null,
          currentPrice: 840000,
          status: "sent",
        }),
      ]),
    );
    expect(steps.filter((step) => step === "telegram:request")).toHaveLength(1);
  });

  it("quietly baselines mixed direct-city and 91381 inventory after reconciling overlap", async () => {
    const steps: string[] = [];
    const mixedCriteria = {
      ...defaultListingSearchCriteria,
      cities: ["Corona", "Stevenson Ranch"] as const,
    };
    const repository = new IntegrationListingAlertRepository(
      steps,
      createObservation(createNormalizedListing()),
      { revision: 2, appliedRevision: 1 },
    );
    const database = new RecordingSqlDatabase(steps);
    const stevensonRanchListing = createRentCastListing({
      id: "rentcast-91381",
      formattedAddress: "25900 Example Rd, Valencia, CA 91381",
      addressLine1: "25900 Example Rd",
      city: "Valencia",
      zipCode: "91381",
      latitude: 34.3905,
      longitude: -118.573,
      mlsNumber: "SR26000003",
      price: 839000,
    });
    const rentCastUrls: URL[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin === "https://api.rentcast.io") {
        rentCastUrls.push(url);
        const listings =
          url.searchParams.get("zipCode") === "91381"
            ? [stevensonRanchListing]
            : [createRentCastListing(), stevensonRanchListing];
        return Response.json(listings, {
          headers: { "X-Total-Count": String(listings.length) },
        });
      }
      if (url.origin === "https://api.telegram.org") {
        throw new Error("Revision baseline must not send Telegram alerts");
      }
      throw new Error(`Unexpected HTTP request: ${url.origin}`);
    });
    const dependencies: ProductionDependencies = {
      createDatabase: () => database,
      runMigrations: async () => {},
      createSearchProfileQuery: () => ({
        findPrimaryProfile: async () =>
          createSearchProfile({
            criteria: mixedCriteria,
            revision: 2,
            appliedRevision: 1,
          }),
      }),
      createRepository: () => repository,
      createSource: (options) =>
        new RentCastListingSource({
          client: new RentCastSaleListingsClient({
            apiKey: options.apiKey,
            fetch: options.fetch,
          }),
          searchCriteria: options.searchCriteria,
          searchAreas: options.searchAreas,
          now: options.now,
        }),
      createNotifications: (options) => new TelegramBotClient(options),
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
        now: () => new Date("2026-08-24T19:00:00.000Z"),
      },
      dependencies,
    );

    expect(rentCastUrls).toHaveLength(2);
    expect(rentCastUrls[0]?.searchParams.get("city")).toBe("Corona");
    expect(rentCastUrls[0]?.searchParams.get("state")).toBe("CA");
    expect(rentCastUrls[0]?.searchParams.get("address")).toBeNull();
    expect(rentCastUrls[0]?.searchParams.get("radius")).toBeNull();
    expect(rentCastUrls[0]?.searchParams.get("zipCode")).toBeNull();
    expect(rentCastUrls[1]?.searchParams.get("zipCode")).toBe("91381");
    expect(rentCastUrls[1]?.searchParams.get("city")).toBeNull();
    expect(rentCastUrls[1]?.searchParams.get("address")).toBeNull();
    expect(repository.listingSearchRevisions.appliedRevision).toBe(2);
    expect(repository.observations).toHaveLength(2);
    expect(repository.listingSnapshots).toHaveLength(2);
    expect(repository.listingSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          city: "Valencia",
          zipCode: "91381",
        }),
      ]),
    );
    expect(repository.events).toEqual([]);
    expect(
      fetch.mock.calls.filter(
        ([input]) => (input as URL).origin === "https://api.telegram.org",
      ),
    ).toHaveLength(0);
    expect(steps).toContain("database:close");
  });

  it.each([
    {
      name: "one selected market",
      cities: ["Corona"],
      expectedAreas: ["Corona"],
    },
    {
      name: "Irvine only",
      cities: ["Irvine"],
      expectedAreas: ["Irvine"],
    },
    {
      name: "all five incorporated markets",
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
      ],
      expectedAreas: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
      ],
    },
    {
      name: "all six product markets",
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
      ],
      expectedAreas: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "91381",
      ],
    },
    {
      name: "all six incorporated markets",
      cities: [
        "Irvine",
        "Jurupa Valley",
        "Corona",
        "Eastvale",
        "Chino Hills",
        "Chino",
      ],
      expectedAreas: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Irvine",
      ],
    },
    {
      name: "all seven product markets",
      cities: [
        "Irvine",
        "Stevenson Ranch",
        "Jurupa Valley",
        "Corona",
        "Eastvale",
        "Chino Hills",
        "Chino",
      ],
      expectedAreas: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "91381",
        "Irvine",
      ],
    },
  ] as const)(
    "quietly baselines $name with one request per canonical provider area",
    async ({ cities, expectedAreas }) => {
      const steps: string[] = [];
      const repository = new IntegrationListingAlertRepository(
        steps,
        createObservation(createNormalizedListing()),
        { revision: 2, appliedRevision: 1 },
      );
      const database = new RecordingSqlDatabase(steps);
      const rentCastUrls: URL[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = input as URL;
        if (url.origin === "https://api.rentcast.io") {
          rentCastUrls.push(url);
          const index = rentCastUrls.length;
          const providerCity = url.searchParams.get("city") ?? "Valencia";
          const zipCode = url.searchParams.get("zipCode") ?? "92882";
          return Response.json(
            [
              createRentCastListing({
                id: `rentcast-market-${index}`,
                formattedAddress: `${100 + index} Market St, ${providerCity}, CA ${zipCode}`,
                addressLine1: `${100 + index} Market St`,
                city: providerCity,
                zipCode,
                mlsNumber: `MATRIX${index}`,
              }),
            ],
            { headers: { "X-Total-Count": "1" } },
          );
        }
        if (url.origin === "https://api.telegram.org") {
          throw new Error("Revision baseline must not send Telegram alerts");
        }
        throw new Error(`Unexpected HTTP request: ${url.origin}`);
      });
      const now = vi.fn(() => new Date("2026-08-25T19:00:00.000Z"));
      const dependencies: ProductionDependencies = {
        createDatabase: () => database,
        runMigrations: async () => {},
        createSearchProfileQuery: () => ({
          findPrimaryProfile: async () =>
            createSearchProfile({
              criteria: {
                ...defaultListingSearchCriteria,
                cities,
              },
              revision: 2,
              appliedRevision: 1,
            }),
        }),
        createRepository: () => repository,
        createSource: (options) =>
          new RentCastListingSource({
            client: new RentCastSaleListingsClient({
              apiKey: options.apiKey,
              fetch: options.fetch,
            }),
            searchCriteria: options.searchCriteria,
            searchAreas: options.searchAreas,
            now: options.now,
          }),
        createNotifications: (options) => new TelegramBotClient(options),
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
          now,
        },
        dependencies,
      );

      expect(rentCastUrls).toHaveLength(expectedAreas.length);
      expect(
        rentCastUrls.map(
          (url) =>
            url.searchParams.get("city") ?? url.searchParams.get("zipCode"),
        ),
      ).toEqual(expectedAreas);
      for (const url of rentCastUrls) {
        expect(url.searchParams.get("address")).toBeNull();
        expect(url.searchParams.get("radius")).toBeNull();
        expect(url.searchParams.get("county")).toBeNull();
      }
      expect(repository.listingSearchRevisions.appliedRevision).toBe(2);
      expect(repository.listingSnapshots).toHaveLength(expectedAreas.length);
      expect(repository.events).toEqual([]);
      expect(now).toHaveBeenCalledTimes(2);
      expect(steps).toContain("database:close");
      expect(
        fetch.mock.calls.filter(
          ([input]) => (input as URL).origin === "https://api.telegram.org",
        ),
      ).toHaveLength(0);
      if (
        rentCastUrls.some(
          (url) => url.searchParams.get("zipCode") === "91381",
        )
      ) {
        expect(repository.listingSnapshots).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ city: "Valencia", zipCode: "91381" }),
          ]),
        );
      }
      if (rentCastUrls.some((url) => url.searchParams.get("city") === "Irvine")) {
        const irvineUrl = rentCastUrls.find(
          (url) => url.searchParams.get("city") === "Irvine",
        );
        expect(irvineUrl?.searchParams.get("state")).toBe("CA");
        expect(irvineUrl?.searchParams.get("zipCode")).toBeNull();
        expect(repository.listingSnapshots.at(-1)).toMatchObject({
          city: "Irvine",
        });
      }
    },
  );

  it("does not partially persist or notify when the seventh market request fails", async () => {
    const steps: string[] = [];
    const initialListing = createNormalizedListing();
    const repository = new IntegrationListingAlertRepository(
      steps,
      createObservation(initialListing),
      { revision: 2, appliedRevision: 1 },
    );
    const database = new RecordingSqlDatabase(steps);
    let providerCall = 0;
    const rentCastUrls: URL[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.origin === "https://api.rentcast.io") {
        providerCall += 1;
        rentCastUrls.push(url);
        if (providerCall < 7) {
          return Response.json([createRentCastListing()], {
            headers: { "X-Total-Count": "1" },
          });
        }
        throw new Error("RentCast request failed");
      }
      if (url.origin === "https://api.telegram.org") {
        throw new Error("Failed source collection must not send Telegram alerts");
      }
      throw new Error(`Unexpected HTTP request: ${url.origin}`);
    });
    const now = vi.fn(() => new Date("2026-08-24T19:00:00.000Z"));
    const dependencies: ProductionDependencies = {
      createDatabase: () => database,
      runMigrations: async () => {},
      createSearchProfileQuery: () => ({
        findPrimaryProfile: async () =>
          createSearchProfile({
            criteria: {
              ...defaultListingSearchCriteria,
              cities: [
                "Chino",
                "Chino Hills",
                "Eastvale",
                "Corona",
                "Jurupa Valley",
                "Stevenson Ranch",
                "Irvine",
              ],
            },
            revision: 2,
            appliedRevision: 1,
          }),
      }),
      createRepository: () => repository,
      createSource: (options) =>
        new RentCastListingSource({
          client: new RentCastSaleListingsClient({
            apiKey: options.apiKey,
            fetch: options.fetch,
          }),
          searchCriteria: options.searchCriteria,
          searchAreas: options.searchAreas,
          now: options.now,
        }),
      createNotifications: (options) => new TelegramBotClient(options),
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
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("RentCast request failed");

    expect(providerCall).toBe(7);
    expect(
      rentCastUrls.map((url) =>
        url.searchParams.get("city") ?? url.searchParams.get("zipCode"),
      ),
    ).toEqual([
      "Chino",
      "Chino Hills",
      "Eastvale",
      "Corona",
      "Jurupa Valley",
      "91381",
      "Irvine",
    ]);
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(repository.calls).toEqual([]);
    expect(repository.observations).toEqual([createObservation(initialListing)]);
    expect(repository.listingSnapshots).toEqual([]);
    expect(repository.events).toEqual([]);
    expect(repository.listingSearchRevisions.appliedRevision).toBe(1);
    expect(now).not.toHaveBeenCalled();
    expect(steps).toContain("database:close");
  });
});

function createSearchProfile(
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

class IntegrationListingAlertRepository extends FakeListingAlertStateRepository {
  constructor(
    private readonly steps: string[],
    observation: ListingPriceObservation,
    revisions: { revision: number; appliedRevision: number } = {
      revision: 1,
      appliedRevision: 1,
    },
  ) {
    super({
      baselineInitialized: true,
      observations: [observation],
      listingSearchRevision: revisions.revision,
      listingSearchAppliedRevision: revisions.appliedRevision,
    });
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
