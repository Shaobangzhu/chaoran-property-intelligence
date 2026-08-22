import { describe, expect, it } from "vitest";

import {
  createListingAddressKey,
  type ListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  FakeListingAlertNotifications,
  FakeListingAlertStateRepository,
} from "./fakeListingAlerts.js";
import type {
  ListingAlertEvent,
  ListingAlertTransition,
  ListingPriceObservation,
} from "./listingAlertContracts.js";

describe("FakeListingAlertStateRepository", () => {
  it("initializes and returns cloned baseline state deterministically", async () => {
    const listing = createObservedListing();
    const observation = createObservation();
    const repository = new FakeListingAlertStateRepository();

    await repository.initializePriceObservationBaseline([
      { listing, observation },
    ]);
    listing.price = 1;
    observation.latestPrice = 1;

    expect(await repository.isPriceObservationBaselineInitialized()).toBe(true);
    expect(repository.listingSnapshots[0]?.price).toBe(810000);
    expect(repository.observations[0]?.latestPrice).toBe(810000);
    expect(repository.calls.map((call) => call.method)).toEqual([
      "initializePriceObservationBaseline",
      "isPriceObservationBaselineInitialized",
    ]);
  });

  it("finds observations in requested order without duplicate results", async () => {
    const firstEntry = {
      listing: createObservedListing(),
      observation: createObservation({
        observedAt: "2026-08-21T15:00:00.000Z",
      }),
    };
    const secondListing = createObservedListing({
      sourceListingId: "rentcast-100-main",
      formattedAddress: "100 Main St, Chino, CA 91710",
      addressLine1: "100 Main St",
      city: "Chino",
      zipCode: "91710",
      mlsNumber: "CV26000001",
      price: 799000,
    });
    const secondAddressKey = createAddressKeyFor(secondListing);
    const secondEntry = {
      listing: secondListing,
      observation: createObservation({
        addressKey: secondAddressKey,
        listingKey: "mls:CRMLS:CV26000001:2026-08-19T00:00:00.000Z",
        sourceListingId: "rentcast-100-main",
        latestPrice: 799000,
      }),
    };
    const repository = new FakeListingAlertStateRepository({
      baselineEntries: [firstEntry, secondEntry],
    });

    const found = await repository.findPriceObservations([
      secondAddressKey,
      createAddressKey(),
      secondAddressKey,
    ]);

    expect(found.map((observation) => observation.addressKey)).toEqual([
      secondAddressKey,
      createAddressKey(),
    ]);
  });

  it("persists transitions, orders pending events, and marks only selected events sent", async () => {
    const laterEvent = createPriceDropEvent({
      eventKey: "price-drop:later",
      observedAt: "2026-08-21T16:00:00.000Z",
    });
    const earlierEvent = createNewListingEvent({
      eventKey: "new-listing:earlier",
      observedAt: "2026-08-21T14:00:00.000Z",
    });
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
      events: [laterEvent, earlierEvent],
    });

    await repository.saveListingAlertTransitions([createPriceDropTransition()]);
    const pending = await repository.findPendingListingAlertEvents();
    await repository.markListingAlertEventsSent([earlierEvent.eventKey]);

    expect(pending.map((event) => event.eventKey)).toEqual([
      earlierEvent.eventKey,
      createPriceDropEvent().eventKey,
      laterEvent.eventKey,
    ]);
    expect(
      repository.events.find(
        (event) => event.eventKey === earlierEvent.eventKey,
      )?.status,
    ).toBe("sent");
    expect(
      repository.events.find((event) => event.eventKey === laterEvent.eventKey)
        ?.status,
    ).toBe("pending");
  });

  it("rejects mutation of an existing immutable event payload", async () => {
    const transition = createPriceDropTransition();
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
      events: [transition.event!],
    });
    const changedTransition = createPriceDropTransition();
    changedTransition.event = createPriceDropEvent({ previousPrice: 830000 });

    await expect(
      repository.saveListingAlertTransitions([changedTransition]),
    ).rejects.toThrow("is immutable");
  });

  it("keeps a sent event sent when an identical transition is replayed", async () => {
    const transition = createPriceDropTransition();
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
      events: [{ ...transition.event!, status: "sent" }],
    });

    await repository.saveListingAlertTransitions([transition]);

    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.status).toBe("sent");
  });

  it("records a configured failure without changing repository state", async () => {
    const repository = new FakeListingAlertStateRepository({
      baselineInitialized: true,
      failures: {
        saveListingAlertTransitions: new Error("database unavailable"),
      },
    });

    await expect(
      repository.saveListingAlertTransitions([createPriceDropTransition()]),
    ).rejects.toThrow("database unavailable");

    expect(repository.observations).toEqual([]);
    expect(repository.events).toEqual([]);
    expect(repository.calls[0]?.method).toBe("saveListingAlertTransitions");
  });

  it("does not partially initialize an invalid baseline batch", async () => {
    const invalidObservation = createObservation({ latestPrice: 1 });
    const repository = new FakeListingAlertStateRepository();

    await expect(
      repository.initializePriceObservationBaseline([
        {
          listing: createObservedListing(),
          observation: createObservation(),
        },
        {
          listing: createObservedListing(),
          observation: invalidObservation,
        },
      ]),
    ).rejects.toThrow("Listing price must match the latest observation");

    expect(repository.observations).toEqual([]);
    expect(repository.listingSnapshots).toEqual([]);
    expect(await repository.isPriceObservationBaselineInitialized()).toBe(
      false,
    );
  });
});

describe("FakeListingAlertNotifications", () => {
  it("captures cloned event batches", async () => {
    const event = createPriceDropEvent();
    const notifications = new FakeListingAlertNotifications();

    await notifications.sendListingAlerts([event]);
    event.currentPrice = 1;

    expect(notifications.calls[0]?.[0]?.currentPrice).toBe(810000);
  });

  it("captures the attempted batch before a configured failure", async () => {
    const notifications = new FakeListingAlertNotifications({
      failure: new Error("Telegram unavailable"),
    });

    await expect(
      notifications.sendListingAlerts([createPriceDropEvent()]),
    ).rejects.toThrow("Telegram unavailable");
    expect(notifications.calls).toHaveLength(1);
  });
});

function createAddressKeyFor(listing: ReturnType<typeof createObservedListing>) {
  return createListingAddressKey(listing);
}

function createObservedListing(
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
    price: 810000,
    status: "Active",
    listedDate: "2026-08-19T00:00:00.000Z",
    lastSeenDate: "2026-08-21T12:00:00.000Z",
    firstDiscoveredAt: "2026-08-19T13:00:00.000Z",
    ...overrides,
  };
}

function createAddressKey(): ListingAddressKey {
  return createListingAddressKey(createObservedListing());
}

function createObservation(
  overrides: Partial<ListingPriceObservation> = {},
): ListingPriceObservation {
  return {
    addressKey: createAddressKey(),
    listingKey: "mls:CRMLS:PW26181310:2026-08-19T00:00:00.000Z",
    sourceListingId: "rentcast-3420",
    latestPrice: 810000,
    latestListedDate: "2026-08-19T00:00:00.000Z",
    latestLastSeenDate: "2026-08-21T12:00:00.000Z",
    observedAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

function createNewListingEvent(
  overrides: Partial<ListingAlertEvent> = {},
): ListingAlertEvent {
  return {
    eventKey: "new-listing:PW26181310:2026-08-19T00%3A00%3A00.000Z",
    listingKey: "mls:CRMLS:PW26181310:2026-08-19T00:00:00.000Z",
    addressKey: createAddressKey(),
    kind: "new-listing",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    previousPrice: null,
    currentPrice: 810000,
    status: "pending",
    observedAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  } as ListingAlertEvent;
}

function createPriceDropEvent(
  overrides: Partial<ListingAlertEvent> = {},
): ListingAlertEvent {
  return {
    eventKey: "price-drop:PW26181310:825000:810000:2026-08-21T15%3A00%3A00.000Z",
    listingKey: "mls:CRMLS:PW26181310:2026-08-19T00:00:00.000Z",
    addressKey: createAddressKey(),
    kind: "price-drop",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    previousPrice: 825000,
    currentPrice: 810000,
    status: "pending",
    observedAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  } as ListingAlertEvent;
}

function createPriceDropTransition(): ListingAlertTransition {
  return {
    listing: createObservedListing(),
    observation: createObservation(),
    event: createPriceDropEvent(),
  };
}
