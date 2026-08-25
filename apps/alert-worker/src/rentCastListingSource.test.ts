import { describe, expect, it, vi } from "vitest";

import {
  defaultRentCastSaleListingsSearchCriteria,
  type RentCastListingsPort,
  type RentCastSaleListing,
  type RentCastSaleListingsPage,
  type RentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

import {
  IncompleteRentCastListingPageError,
  InvalidRentCastListingSearchAreasError,
  RentCastListingCoverageExceededError,
  RentCastListingSource,
} from "./rentCastListingSource.js";
import { selectRentCastSaleListingsSearchAreas } from "./rentCastSearchAreas.js";

const allSevenMarketSearchAreas = selectRentCastSaleListingsSearchAreas([
  "Irvine",
  "Stevenson Ranch",
  "Jurupa Valley",
  "Corona",
  "Eastvale",
  "Chino Hills",
  "Chino",
]);

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
      searchAreas: [{ kind: "city", city: "Corona" }],
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
      { kind: "city", city: "Corona" },
    );
  });

  it("fetches all seven market areas sequentially and flattens only after every area succeeds", async () => {
    const pages = allSevenMarketSearchAreas.map((area, index) =>
      createPage([
        createListing({
          id: `rentcast-${index + 1}`,
          city: area.kind === "city" ? area.city : "Valencia",
          zipCode: area.kind === "zip" ? area.zipCode : "92882",
        }),
      ]),
    );
    const client = createSequentialClient(pages);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));
    const source = new RentCastListingSource({
      client,
      searchCriteria: defaultRentCastSaleListingsSearchCriteria,
      searchAreas: allSevenMarketSearchAreas,
      now,
    });

    const listings = await source.getActiveSaleListings();

    expect(listings).toHaveLength(7);
    expect(listings.at(-1)).toMatchObject({
      sourceListingId: "rentcast-7",
      city: "Irvine",
      zipCode: "92882",
      firstDiscoveredAt: "2026-08-24T20:00:00.000Z",
    });
    expect(client.searchSaleListings.mock.calls).toEqual(
      allSevenMarketSearchAreas.map((area) => [
        defaultRentCastSaleListingsSearchCriteria,
        area,
      ]),
    );
    expect(now).toHaveBeenCalledOnce();
  });

  it("does not return or normalize earlier areas when the seventh request fails", async () => {
    const providerFailure = new Error("RentCast request failed");
    const client = createSequentialClient([
      ...allSevenMarketSearchAreas.slice(0, -1).map(() =>
        createPage([createListing()]),
      ),
      providerFailure,
    ]);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));
    const source = createSource(client, allSevenMarketSearchAreas, now);

    await expect(source.getActiveSaleListings()).rejects.toBe(providerFailure);
    expect(client.searchSaleListings).toHaveBeenCalledTimes(7);
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
  ])("fails closed when a later area $name", async ({ page, error }) => {
    const client = createSequentialClient([
      ...allSevenMarketSearchAreas.slice(0, -1).map(() =>
        createPage([createListing()]),
      ),
      page,
    ]);
    const now = vi.fn(() => new Date("2026-08-24T20:00:00.000Z"));

    await expect(
      createSource(client, allSevenMarketSearchAreas, now).getActiveSaleListings(),
    ).rejects.toBeInstanceOf(error);
    expect(client.searchSaleListings).toHaveBeenCalledTimes(7);
    expect(now).not.toHaveBeenCalled();
  });

  it("preserves overlapping rows for downstream canonical reconciliation", async () => {
    const listing = createListing();
    const client = createSequentialClient([
      createPage([listing]),
      createPage([{ ...listing }]),
    ]);

    await expect(
      createSource(client, [
        { kind: "city", city: "Corona" },
        { kind: "city", city: "Jurupa Valley" },
      ]).getActiveSaleListings(),
    ).resolves.toMatchObject([
      { sourceListingId: "rentcast-1" },
      { sourceListingId: "rentcast-1" },
    ]);
  });

  it.each([
    ["missing", undefined],
    ["empty", []],
  ] as const)(
    "rejects a %s search-area list without falling back",
    (_name, searchAreas) => {
      expect(
        () =>
          new RentCastListingSource({
            client: createClient(createPage([])),
            searchCriteria: defaultRentCastSaleListingsSearchCriteria,
            searchAreas:
              searchAreas as readonly RentCastSaleListingsSearchArea[],
            now: () => new Date("2026-08-22T20:00:00.000Z"),
          }),
      ).toThrow(InvalidRentCastListingSearchAreasError);
    },
  );

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
      searchAreas: [{ kind: "city", city: "Corona" }],
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
      searchAreas: [{ kind: "city", city: "Corona" }],
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

function createSource(
  client: RentCastListingsPort,
  searchAreas: readonly RentCastSaleListingsSearchArea[],
  now: () => Date = () => new Date("2026-08-24T20:00:00.000Z"),
): RentCastListingSource {
  return new RentCastListingSource({
    client,
    searchCriteria: defaultRentCastSaleListingsSearchCriteria,
    searchAreas,
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
