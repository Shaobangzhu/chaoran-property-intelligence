import { describe, expect, it } from "vitest";

import type { RentCastNormalizedListing } from "@chaoran-property-intelligence/domain";

import { createListingKey } from "./listingIdentity.js";

describe("createListingKey", () => {
  it("retains the legacy MLS identity format", () => {
    expect(
      createListingKey(
        createListing({
          mlsName: "CRMLS",
          mlsNumber: "PW26181310",
          listedDate: "2026-08-19T00:00:00.000Z",
        }),
      ),
    ).toBe("mls:CRMLS:PW26181310:2026-08-19T00:00:00.000Z");
  });

  it("retains the legacy RentCast fallback format", () => {
    expect(
      createListingKey(
        createListing({
          sourceListingId: "rentcast-3420",
          mlsName: null,
          mlsNumber: null,
          listedDate: "2026-08-19T00:00:00.000Z",
        }),
      ),
    ).toBe("rentcast:rentcast-3420:2026-08-19T00:00:00.000Z");
  });
});

function createListing(
  overrides: Partial<RentCastNormalizedListing> = {},
): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "rentcast-listing-id",
    mlsName: null,
    mlsNumber: null,
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
