import { describe, expect, it } from "vitest";

import {
  createListingAddressKey,
  matchesMvpSearchCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  AmbiguousListingAddressObservationError,
  CheckListingAlerts,
  InvalidListingAlertClockError,
} from "./checkListingAlerts.js";
import type { ListingSourcePort } from "./checkNewListings.js";
import {
  FakeListingAlertNotifications,
  FakeListingAlertStateRepository,
} from "./fakeListingAlerts.js";
import type {
  ListingAlertBaselineEntry,
  ListingAlertNotificationPort,
  ListingPriceObservation,
} from "./listingAlertContracts.js";
import { createListingKey } from "./listingIdentity.js";

const firstRunAt = new Date("2026-08-21T15:00:00.000Z");
const secondRunAt = new Date("2026-08-22T15:00:00.000Z");

describe("CheckListingAlerts", () => {
  it("silently initializes only new-listing-eligible baseline entries", async () => {
    const eligible = createListing();
    const belowFloor = createListing({
      sourceListingId: "rentcast-below-floor",
      mlsNumber: "PW26181311",
      formattedAddress: "100 Main St, Chino, CA 91710",
      addressLine1: "100 Main St",
      city: "Chino",
      zipCode: "91710",
      price: 770000,
    });
    const outsideMarket = createListing({
      sourceListingId: "rentcast-outside",
      mlsNumber: "OC26000001",
      formattedAddress: "10 Birch St, Brea, CA 92821",
      addressLine1: "10 Birch St",
      city: "Brea",
      zipCode: "92821",
    });
    const source = new MutableListingSource([
      eligible,
      belowFloor,
      outsideMarket,
    ]);
    const repository = new FakeListingAlertStateRepository();
    const notifications = new FakeListingAlertNotifications();

    await createUseCase(source, repository, notifications, () => firstRunAt)
      .execute();

    expect(repository.observations).toEqual([
      createObservation(eligible, firstRunAt.toISOString()),
    ]);
    expect(repository.events).toEqual([]);
    expect(notifications.calls).toEqual([]);
    expect(await repository.isPriceObservationBaselineInitialized()).toBe(true);
  });

  it("initializes an empty baseline without consulting the clock", async () => {
    const source = new MutableListingSource([
      createListing({ price: 770000 }),
    ]);
    const repository = new FakeListingAlertStateRepository();
    let clockCalls = 0;

    await createUseCase(
      source,
      repository,
      new FakeListingAlertNotifications(),
      () => {
        clockCalls += 1;
        return new Date(Number.NaN);
      },
    ).execute();

    expect(clockCalls).toBe(0);
    expect(repository.observations).toEqual([]);
    expect(await repository.isPriceObservationBaselineInitialized()).toBe(true);
  });

  it("persists, delivers, and marks an unseen eligible listing sent", async () => {
    const listing = createListing();
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
    });
    const notifications = new FakeListingAlertNotifications();

    await createUseCase(
      new MutableListingSource([listing]),
      repository,
      notifications,
      () => firstRunAt,
    ).execute();

    expect(repository.events).toMatchObject([
      {
        kind: "new-listing",
        listingKey: createListingKey(listing),
        previousPrice: null,
        currentPrice: 825000,
        status: "sent",
      },
    ]);
    expect(notifications.calls[0]?.map((event) => event.kind)).toEqual([
      "new-listing",
    ]);
  });

  it("does not track or alert an unseen below-floor listing", async () => {
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
    });
    let clockCalls = 0;

    await createUseCase(
      new MutableListingSource([createListing({ price: 779999 })]),
      repository,
      new FakeListingAlertNotifications(),
      () => {
        clockCalls += 1;
        return firstRunAt;
      },
    ).execute();

    expect(clockCalls).toBe(0);
    expect(repository.observations).toEqual([]);
    expect(repository.events).toEqual([]);
  });

  it("updates unchanged observation metadata without creating an event", async () => {
    const previousListing = createListing({
      lastSeenDate: "2026-08-20T12:00:00.000Z",
    });
    const currentListing = createListing({
      lastSeenDate: "2026-08-21T12:00:00.000Z",
    });
    const repository = createInitializedRepository(previousListing);

    await createUseCase(
      new MutableListingSource([currentListing]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events).toEqual([]);
    expect(repository.observations[0]).toMatchObject({
      latestPrice: 825000,
      latestLastSeenDate: "2026-08-21T12:00:00.000Z",
      observedAt: firstRunAt.toISOString(),
    });
  });

  it("compares a decrease with the immediately previous persisted increase", async () => {
    const original = createListing({ price: 825000 });
    const source = new MutableListingSource([
      createListing({
        price: 835000,
        lastSeenDate: "2026-08-21T12:00:00.000Z",
      }),
    ]);
    const repository = createInitializedRepository(original);
    const notifications = new FakeListingAlertNotifications();

    await createUseCase(source, repository, notifications, () => firstRunAt)
      .execute();
    source.listings = [
      createListing({
        price: 830000,
        lastSeenDate: "2026-08-22T12:00:00.000Z",
      }),
    ];
    await createUseCase(source, repository, notifications, () => secondRunAt)
      .execute();

    expect(repository.events).toMatchObject([
      {
        kind: "price-drop",
        previousPrice: 835000,
        currentPrice: 830000,
        status: "sent",
      },
    ]);
    expect(notifications.calls).toHaveLength(1);
  });

  it("creates a price-drop event for a one-dollar decrease", async () => {
    const repository = createInitializedRepository(
      createListing({ price: 825000 }),
    );

    await createUseCase(
      new MutableListingSource([createListing({ price: 824999 })]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events[0]).toMatchObject({
      kind: "price-drop",
      previousPrice: 825000,
      currentPrice: 824999,
      status: "sent",
    });
  });

  it("alerts when a tracked address drops below 780000", async () => {
    const repository = createInitializedRepository(
      createListing({ price: 825000 }),
    );

    await createUseCase(
      new MutableListingSource([createListing({ price: 770000 })]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events[0]).toMatchObject({
      kind: "price-drop",
      previousPrice: 825000,
      currentPrice: 770000,
    });
  });

  it("gives an eligible new listing identity precedence over a price drop", async () => {
    const previousListing = createListing({ price: 825000 });
    const relisted = createListing({
      sourceListingId: "rentcast-relisted",
      mlsNumber: "PW26199999",
      listedDate: "2026-08-21T00:00:00.000Z",
      price: 810000,
    });
    const repository = createInitializedRepository(previousListing);

    await createUseCase(
      new MutableListingSource([relisted]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      kind: "new-listing",
      listingKey: createListingKey(relisted),
      previousPrice: null,
      currentPrice: 810000,
    });
  });

  it("uses price-drop semantics for a changed identity below the new-listing floor", async () => {
    const previousListing = createListing({ price: 825000 });
    const belowFloorRelisting = createListing({
      sourceListingId: "rentcast-relisted",
      mlsNumber: "PW26199999",
      listedDate: "2026-08-21T00:00:00.000Z",
      price: 770000,
    });
    const repository = createInitializedRepository(previousListing);

    await createUseCase(
      new MutableListingSource([belowFloorRelisting]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events[0]).toMatchObject({
      kind: "price-drop",
      listingKey: createListingKey(belowFloorRelisting),
      previousPrice: 825000,
      currentPrice: 770000,
    });
  });

  it("does not create or resend an event for a repeated provider snapshot", async () => {
    const previousListing = createListing({ price: 825000 });
    const droppedListing = createListing({ price: 810000 });
    const source = new MutableListingSource([droppedListing]);
    const repository = createInitializedRepository(previousListing);
    const notifications = new FakeListingAlertNotifications();

    await createUseCase(source, repository, notifications, () => firstRunAt)
      .execute();
    await createUseCase(source, repository, notifications, () => secondRunAt)
      .execute();

    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.status).toBe("sent");
    expect(notifications.calls).toHaveLength(1);
  });

  it("establishes a comparison baseline for migrated legacy state without alerting", async () => {
    const previousListing = createListing({ price: 825000 });
    const previousObservation = createObservation(
      previousListing,
      "2026-08-20T15:00:00.000Z",
    );
    previousObservation.comparisonReady = false;
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
      observations: [previousObservation],
    });

    await createUseCase(
      new MutableListingSource([createListing({ price: 810000 })]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.events).toEqual([]);
    expect(repository.observations[0]).toMatchObject({
      latestPrice: 810000,
      comparisonReady: true,
    });
  });

  it("creates the same transition key when a storage retry uses a later clock", async () => {
    const firstEventKey = await captureFailedTransitionEventKey(firstRunAt);
    const secondEventKey = await captureFailedTransitionEventKey(secondRunAt);

    expect(secondEventKey).toBe(firstEventKey);
  });

  it("preserves and delivers two ordered drops when the first send failed", async () => {
    const source = new MutableListingSource([
      createListing({ price: 815000 }),
    ]);
    const repository = createInitializedRepository(
      createListing({ price: 825000 }),
    );
    const failedNotifications = new FakeListingAlertNotifications({
      failure: new Error("Telegram unavailable"),
    });

    await expect(
      createUseCase(source, repository, failedNotifications, () => firstRunAt)
        .execute(),
    ).rejects.toThrow("Telegram unavailable");

    source.listings = [
      createListing({
        price: 805000,
        lastSeenDate: "2026-08-22T12:00:00.000Z",
      }),
    ];
    const successfulNotifications = new FakeListingAlertNotifications();
    await createUseCase(
      source,
      repository,
      successfulNotifications,
      () => secondRunAt,
    ).execute();

    expect(successfulNotifications.calls[0]).toMatchObject([
      { previousPrice: 825000, currentPrice: 815000 },
      { previousPrice: 815000, currentPrice: 805000 },
    ]);
    expect(repository.events.map((event) => event.status)).toEqual([
      "sent",
      "sent",
    ]);
  });

  it("retries a pending event even when the provider returns no listings", async () => {
    const source = new MutableListingSource([
      createListing({ price: 810000 }),
    ]);
    const repository = createInitializedRepository(
      createListing({ price: 825000 }),
    );

    await expect(
      createUseCase(
        source,
        repository,
        new FakeListingAlertNotifications({
          failure: new Error("Telegram unavailable"),
        }),
        () => firstRunAt,
      ).execute(),
    ).rejects.toThrow("Telegram unavailable");

    source.listings = [];
    const notifications = new FakeListingAlertNotifications();
    await createUseCase(source, repository, notifications, () => secondRunAt)
      .execute();

    expect(notifications.calls[0]).toHaveLength(1);
    expect(repository.events[0]?.status).toBe("sent");
  });

  it("does not notify or partially persist when transition storage fails", async () => {
    const previousListing = createListing({ price: 825000 });
    const repository = new FakeListingAlertStateRepository({
      baselineEntries: [
        createBaselineEntry(
          previousListing,
          "2026-08-20T15:00:00.000Z",
        ),
      ],
      failures: {
        saveListingAlertTransitions: new Error("database unavailable"),
      },
    });
    const notifications = new FakeListingAlertNotifications();

    await expect(
      createUseCase(
        new MutableListingSource([createListing({ price: 810000 })]),
        repository,
        notifications,
        () => firstRunAt,
      ).execute(),
    ).rejects.toThrow("database unavailable");

    expect(repository.observations[0]?.latestPrice).toBe(825000);
    expect(repository.events).toEqual([]);
    expect(notifications.calls).toEqual([]);
  });

  it("collapses equivalent duplicate provider rows", async () => {
    const listing = createListing();
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
    });

    await createUseCase(
      new MutableListingSource([listing, { ...listing }]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.observations).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
  });

  it("fails before persistence for conflicting rows at one address", async () => {
    const listing = createListing();
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
    });
    const notifications = new FakeListingAlertNotifications();

    await expect(
      createUseCase(
        new MutableListingSource([listing, { ...listing, price: 824000 }]),
        repository,
        notifications,
        () => firstRunAt,
      ).execute(),
    ).rejects.toThrow(AmbiguousListingAddressObservationError);

    expect(repository.calls).toEqual([]);
    expect(repository.observations).toEqual([]);
    expect(notifications.calls).toEqual([]);
  });

  it("rejects an invalid clock before transition persistence", async () => {
    const previousListing = createListing({ price: 825000 });
    const repository = createInitializedRepository(previousListing);

    await expect(
      createUseCase(
        new MutableListingSource([createListing({ price: 810000 })]),
        repository,
        new FakeListingAlertNotifications(),
        () => new Date(Number.NaN),
      ).execute(),
    ).rejects.toThrow(InvalidListingAlertClockError);

    expect(repository.observations[0]?.latestPrice).toBe(825000);
    expect(repository.events).toEqual([]);
    expect(
      repository.calls.some(
        (call) => call.method === "saveListingAlertTransitions",
      ),
    ).toBe(false);
  });

  it("ignores a tracked row that no longer matches acquisition criteria", async () => {
    const previousListing = createListing({ price: 825000 });
    const repository = createInitializedRepository(previousListing);

    await createUseCase(
      new MutableListingSource([
        createListing({ price: 810000, status: "Pending" }),
      ]),
      repository,
      new FakeListingAlertNotifications(),
      () => firstRunAt,
    ).execute();

    expect(repository.observations[0]?.latestPrice).toBe(825000);
    expect(repository.events).toEqual([]);
  });
});

function createUseCase(
  source: ListingSourcePort,
  repository: FakeListingAlertStateRepository,
  notifications: ListingAlertNotificationPort,
  now: () => Date,
): CheckListingAlerts {
  return new CheckListingAlerts({
    source,
    repository,
    notifications,
    criteria: {
      matchesAcquisitionCriteria: matchesPriceAlertAcquisitionCriteria,
      matchesNewListingCriteria: matchesMvpSearchCriteria,
    },
    now,
  });
}

class MutableListingSource implements ListingSourcePort {
  constructor(public listings: RentCastNormalizedListing[]) {}

  async getActiveSaleListings(): Promise<RentCastNormalizedListing[]> {
    return this.listings;
  }
}

function createInitializedRepository(
  listing: RentCastNormalizedListing,
): FakeListingAlertStateRepository {
  return new FakeListingAlertStateRepository({
    baselineEntries: [
      createBaselineEntry(listing, "2026-08-20T15:00:00.000Z"),
    ],
  });
}

async function captureFailedTransitionEventKey(now: Date): Promise<string> {
  const repository = new FakeListingAlertStateRepository({
    baselineEntries: [
      createBaselineEntry(
        createListing({ price: 825000 }),
        "2026-08-20T15:00:00.000Z",
      ),
    ],
    failures: {
      saveListingAlertTransitions: new Error("database unavailable"),
    },
  });

  await expect(
    createUseCase(
      new MutableListingSource([createListing({ price: 810000 })]),
      repository,
      new FakeListingAlertNotifications(),
      () => now,
    ).execute(),
  ).rejects.toThrow("database unavailable");

  const saveCall = repository.calls.find(
    (call) => call.method === "saveListingAlertTransitions",
  );
  if (saveCall?.method !== "saveListingAlertTransitions") {
    throw new Error("Expected the transition to reach persistence");
  }
  const eventKey = saveCall.transitions[0]?.event?.eventKey;
  if (eventKey === undefined) {
    throw new Error("Expected a deterministic transition event key");
  }
  return eventKey;
}

function createBaselineEntry(
  listing: RentCastNormalizedListing,
  observedAt: string,
): ListingAlertBaselineEntry {
  return {
    listing,
    observation: createObservation(listing, observedAt),
  };
}

function createObservation(
  listing: RentCastNormalizedListing,
  observedAt: string,
): ListingPriceObservation {
  return {
    addressKey: createListingAddressKey(listing),
    listingKey: createListingKey(listing),
    sourceListingId: listing.sourceListingId,
    latestPrice: listing.price,
    latestListedDate: listing.listedDate,
    latestLastSeenDate: listing.lastSeenDate,
    comparisonReady: true,
    observedAt,
  };
}

function createListing(
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
    bathrooms: 3,
    price: 825000,
    status: "Active",
    listedDate: "2026-08-19T00:00:00.000Z",
    lastSeenDate: "2026-08-21T12:00:00.000Z",
    firstDiscoveredAt: "2026-08-19T13:00:00.000Z",
    ...overrides,
  };
}
