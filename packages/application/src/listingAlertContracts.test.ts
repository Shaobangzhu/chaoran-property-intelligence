import { describe, expect, it } from "vitest";

import {
  createListingAddressKey,
  type ListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  assertValidListingAlertTransition,
  InvalidListingAlertStateError,
  safeParseListingAlertEvent,
  safeParseListingPriceObservation,
  type ListingAlertEvent,
  type ListingAlertTransition,
  type ListingPriceObservation,
} from "./listingAlertContracts.js";

describe("listing alert contracts", () => {
  it("accepts the two event kinds with their required price shapes", () => {
    const newListingEvent = createNewListingEvent();
    const priceDropEvent = createPriceDropEvent();

    expect(safeParseListingAlertEvent(newListingEvent).success).toBe(true);
    expect(safeParseListingAlertEvent(priceDropEvent).success).toBe(true);
  });

  it.each([
    {
      name: "new listing with a previous price",
      event: { ...createNewListingEvent(), previousPrice: 825000 },
    },
    {
      name: "equal price transition",
      event: { ...createPriceDropEvent(), previousPrice: 810000 },
    },
    {
      name: "price increase",
      event: { ...createPriceDropEvent(), previousPrice: 800000 },
    },
    {
      name: "fractional current price",
      event: { ...createPriceDropEvent(), currentPrice: 809999.5 },
    },
    {
      name: "unknown persisted field",
      event: { ...createPriceDropEvent(), unexpected: true },
    },
    {
      name: "noncanonical address key",
      event: {
        ...createPriceDropEvent(),
        addressKey: "address:v1:3420 New York Dr||corona|ca|92882",
      },
    },
  ])("rejects $name", ({ event }) => {
    expect(safeParseListingAlertEvent(event).success).toBe(false);
  });

  it("strictly validates observations and timestamps", () => {
    const observation = createObservation();

    expect(safeParseListingPriceObservation(observation).success).toBe(true);
    expect(
      safeParseListingPriceObservation({
        ...observation,
        latestPrice: 809999.5,
      }).success,
    ).toBe(false);
    expect(
      safeParseListingPriceObservation({
        ...observation,
        observedAt: "2026-08-21",
      }).success,
    ).toBe(false);
    expect(
      safeParseListingPriceObservation({
        ...observation,
        latestLastSeenDate: "August 21, 2026",
      }).success,
    ).toBe(false);
    expect(
      safeParseListingPriceObservation({ ...observation, extra: "field" })
        .success,
    ).toBe(false);
    expect(
      safeParseListingPriceObservation({
        ...observation,
        comparisonReady: "yes",
      }).success,
    ).toBe(false);
  });

  it("accepts a relationally consistent price-drop transition", () => {
    expect(() =>
      assertValidListingAlertTransition(createPriceDropTransition()),
    ).not.toThrow();
  });

  it.each([
    {
      name: "listing price differs from observation",
      mutate: (transition: ListingAlertTransition) => {
        transition.listing.price = 809000;
      },
    },
    {
      name: "event address differs from observation",
      mutate: (transition: ListingAlertTransition) => {
        if (transition.event !== null) {
          transition.event.addressKey = createListingAddressKey({
            addressLine1: "100 Main St",
            city: "Chino",
            state: "CA",
            zipCode: "91710",
          });
        }
      },
    },
    {
      name: "new transition is already sent",
      mutate: (transition: ListingAlertTransition) => {
        if (transition.event !== null) {
          transition.event.status = "sent";
        }
      },
    },
  ])("rejects a transition when $name", ({ mutate }) => {
    const transition = createPriceDropTransition();
    mutate(transition);

    expect(() => assertValidListingAlertTransition(transition)).toThrow(
      InvalidListingAlertStateError,
    );
  });
});

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
    comparisonReady: true,
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
    expectedPreviousObservation: createObservation({ latestPrice: 825000 }),
    event: createPriceDropEvent(),
  };
}
