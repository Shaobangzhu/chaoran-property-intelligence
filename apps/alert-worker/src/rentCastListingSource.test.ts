import { describe, expect, it, vi } from "vitest";

import {
  defaultRentCastSaleListingsSearchCriteria,
  type RentCastListingsPort,
  type RentCastSaleListing,
  type RentCastSaleListingsPage,
} from "@chaoran-property-intelligence/rentcast";

import {
  IncompleteRentCastListingPageError,
  RentCastListingCoverageExceededError,
  RentCastListingSource,
} from "./rentCastListingSource.js";

describe("RentCastListingSource", () => {
  it("forwards one typed search and normalizes a complete response page", async () => {
    const client = createClient({
      listings: [createListing()],
      responseBodyBytes: 500,
      resultLimit: 500,
      totalCount: 1,
    });
    const source = new RentCastListingSource({
      client,
      searchCriteria: defaultRentCastSaleListingsSearchCriteria,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
    });

    await expect(source.getActiveSaleListings()).resolves.toMatchObject([
      {
        source: "rentcast",
        sourceListingId: "rentcast-1",
        propertyType: "Single Family",
        firstDiscoveredAt: "2026-08-22T20:00:00.000Z",
      },
    ]);
    expect(client.searchSaleListings).toHaveBeenCalledOnce();
    expect(client.searchSaleListings).toHaveBeenCalledWith(
      defaultRentCastSaleListingsSearchCriteria,
    );
  });

  it("fails before returning listings when total count exceeds the page cap", async () => {
    const client = createClient({
      listings: [createListing()],
      responseBodyBytes: 500,
      resultLimit: 500,
      totalCount: 501,
    });
    const source = new RentCastListingSource({
      client,
      searchCriteria: defaultRentCastSaleListingsSearchCriteria,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
    });

    await expect(source.getActiveSaleListings()).rejects.toBeInstanceOf(
      RentCastListingCoverageExceededError,
    );
  });

  it("fails when a below-cap page does not contain every matching listing", async () => {
    const client = createClient({
      listings: [createListing()],
      responseBodyBytes: 500,
      resultLimit: 500,
      totalCount: 2,
    });
    const source = new RentCastListingSource({
      client,
      searchCriteria: defaultRentCastSaleListingsSearchCriteria,
      now: () => new Date("2026-08-22T20:00:00.000Z"),
    });

    await expect(source.getActiveSaleListings()).rejects.toBeInstanceOf(
      IncompleteRentCastListingPageError,
    );
  });
});

function createClient(page: RentCastSaleListingsPage) {
  return {
    searchSaleListings: vi.fn<RentCastListingsPort["searchSaleListings"]>(
      async () => page,
    ),
  } satisfies RentCastListingsPort;
}

function createListing(): RentCastSaleListing {
  return {
    id: "rentcast-1",
    formattedAddress: "123 Main St, Corona, CA 92882",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Corona",
    state: "CA",
    zipCode: "92882",
    latitude: 33.8753,
    longitude: -117.5664,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    status: "Active",
    price: 825_000,
    listedDate: "2026-08-20T00:00:00.000Z",
    lastSeenDate: "2026-08-22T12:00:00.000Z",
    mlsName: "CRMLS",
    mlsNumber: "PW26123456",
  };
}
