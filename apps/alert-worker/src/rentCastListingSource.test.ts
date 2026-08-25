import { describe, expect, it, vi } from "vitest";

import {
  defaultRentCastSaleListingsSearchArea,
  defaultRentCastSaleListingsSearchCriteria,
  type RentCastListingsPort,
  type RentCastSaleListing,
  type RentCastSaleListingsPage,
} from "@chaoran-property-intelligence/rentcast";

import {
  IncompleteRentCastListingPageError,
  InvalidRentCastListingSearchAreasError,
  RentCastListingCoverageExceededError,
  RentCastListingSource,
} from "./rentCastListingSource.js";
import { stevensonRanchRentCastSaleListingsSearchArea } from "./rentCastSearchAreas.js";

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
      defaultRentCastSaleListingsSearchArea,
    );
  });

  it("fetches two areas sequentially and flattens only after both succeed", async () => {
    const firstListing = createListing({ id: "rentcast-brea" });
    const secondListing = createListing({
      id: "rentcast-stevenson-ranch",
      city: "Valencia",
      zipCode: "91381",
    });
    const client = createSequentialClient([
      createPage([firstListing]),
      createPage([secondListing]),
    ]);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));
    const source = new RentCastListingSource({
      client,
      searchCriteria: defaultRentCastSaleListingsSearchCriteria,
      searchAreas: [
        defaultRentCastSaleListingsSearchArea,
        stevensonRanchRentCastSaleListingsSearchArea,
      ],
      now,
    });

    await expect(source.getActiveSaleListings()).resolves.toMatchObject([
      {
        sourceListingId: "rentcast-brea",
        firstDiscoveredAt: "2026-08-24T20:00:00.000Z",
      },
      {
        sourceListingId: "rentcast-stevenson-ranch",
        city: "Valencia",
        zipCode: "91381",
        firstDiscoveredAt: "2026-08-24T20:00:00.000Z",
      },
    ]);
    expect(client.searchSaleListings.mock.calls).toEqual([
      [
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ],
      [
        defaultRentCastSaleListingsSearchCriteria,
        stevensonRanchRentCastSaleListingsSearchArea,
      ],
    ]);
    expect(now).toHaveBeenCalledOnce();
  });

  it("does not return or normalize the first area when the second request fails", async () => {
    const providerFailure = new Error("RentCast request failed");
    const client = createSequentialClient([
      createPage([createListing()]),
      providerFailure,
    ]);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));
    const source = createTwoAreaSource(client, now);

    await expect(source.getActiveSaleListings()).rejects.toBe(providerFailure);
    expect(client.searchSaleListings).toHaveBeenCalledTimes(2);
    expect(now).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "exceeds the result limit",
      page: createPage([createListing()], { totalCount: 501 }),
      error: RentCastListingCoverageExceededError,
    },
    {
      name: "is incomplete below the result limit",
      page: createPage([createListing()], { totalCount: 2 }),
      error: IncompleteRentCastListingPageError,
    },
  ])("fails closed when the second area $name", async ({ page, error }) => {
    const client = createSequentialClient([
      createPage([createListing()]),
      page,
    ]);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));

    await expect(
      createTwoAreaSource(client, now).getActiveSaleListings(),
    ).rejects.toBeInstanceOf(error);
    expect(now).not.toHaveBeenCalled();
  });

  it("preserves overlapping rows for downstream canonical reconciliation", async () => {
    const listing = createListing();
    const client = createSequentialClient([
      createPage([listing]),
      createPage([{ ...listing }]),
    ]);

    await expect(
      createTwoAreaSource(client).getActiveSaleListings(),
    ).resolves.toMatchObject([
      { sourceListingId: "rentcast-1" },
      { sourceListingId: "rentcast-1" },
    ]);
  });

  it("rejects an explicitly empty search-area list", () => {
    expect(
      () =>
        new RentCastListingSource({
          client: createClient(createPage([])),
          searchCriteria: defaultRentCastSaleListingsSearchCriteria,
          searchAreas: [],
          now: () => new Date("2026-08-22T20:00:00.000Z"),
        }),
    ).toThrow(InvalidRentCastListingSearchAreasError);
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

function createSequentialClient(
  results: readonly (RentCastSaleListingsPage | Error)[],
) {
  let index = 0;
  return {
    searchSaleListings: vi.fn<RentCastListingsPort["searchSaleListings"]>(
      async () => {
        const result = results[index];
        index += 1;
        if (result === undefined) {
          throw new Error("Unexpected RentCast search");
        }
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    ),
  } satisfies RentCastListingsPort;
}

function createTwoAreaSource(
  client: RentCastListingsPort,
  now: () => Date = () => new Date("2026-08-24T20:00:00.000Z"),
): RentCastListingSource {
  return new RentCastListingSource({
    client,
    searchCriteria: defaultRentCastSaleListingsSearchCriteria,
    searchAreas: [
      defaultRentCastSaleListingsSearchArea,
      stevensonRanchRentCastSaleListingsSearchArea,
    ],
    now,
  });
}

function createPage(
  listings: RentCastSaleListing[],
  overrides: Partial<RentCastSaleListingsPage> = {},
): RentCastSaleListingsPage {
  return {
    listings,
    responseBodyBytes: 500,
    resultLimit: 500,
    totalCount: listings.length,
    ...overrides,
  };
}

function createListing(
  overrides: Partial<RentCastSaleListing> = {},
): RentCastSaleListing {
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
    ...overrides,
  };
}
