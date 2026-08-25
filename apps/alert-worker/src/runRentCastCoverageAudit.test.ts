import { describe, expect, it, vi } from "vitest";

import {
  defaultRentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

import {
  formatRentCastCoverageAuditSummary,
  runRentCastCoverageAudit,
} from "./runRentCastCoverageAudit.js";
import {
  stevensonRanchRentCastSaleListingsSearchArea,
} from "./rentCastSearchAreas.js";

describe("runRentCastCoverageAudit", () => {
  it("summarizes one broadened fixture page without exposing listing data", async () => {
    const listings = [
      createListing({ city: "Chino", price: 825_000 }),
      createListing({ city: "Corona", price: 775_000 }),
      createListing({ city: "Anaheim", price: 700_000 }),
    ];
    const responseBody = JSON.stringify(listings);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(responseBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Total-Count": "3",
        },
      }),
    );
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);

    const summary = await runRentCastCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now,
    });

    const expectedMetrics = {
      belowProductionFloorListings: 2,
      coverageGatePassed: true,
      elapsedMilliseconds: 25,
      maximumPrice: 825_000,
      minimumPrice: 700_000,
      nonTargetCityListings: 1,
      responseBodyBytes: new TextEncoder().encode(responseBody).byteLength,
      resultLimit: 500,
      resultLimitMargin: 497,
      returnedPageComplete: true,
      returnedListings: 3,
      targetCityListings: {
        Chino: 1,
        "Chino Hills": 0,
        Corona: 1,
        Eastvale: 0,
        "Jurupa Valley": 0,
      },
      totalMatchingListings: 3,
    };
    expect(summary).toEqual({
      areas: [
        {
          areaLabel: "Brea radius (20 mi)",
          ...expectedMetrics,
        },
      ],
      combined: expectedMetrics,
    });

    const output = formatRentCastCoverageAuditSummary(summary);
    expect(output).toContain("Coverage gate: PASS");
    expect(output).toContain("Below $780,000: 2");
    expect(output).toContain("Returned price range: $700,000 to $825,000");
    expect(output).toContain("Audited areas: 1");
    expect(output).toContain("Area 1: Brea radius (20 mi)");
    expect(output).not.toContain("123 Main St");
    expect(output).not.toContain("1065 Brea Mall");
    expect(output).not.toContain("test-secret");
    expect(output).not.toContain("api.rentcast.io");
  });

  it("reports sequential Brea and ZIP pages plus combined provider totals", async () => {
    const firstBody = JSON.stringify([
      createListing({ city: "Corona", price: 775_000 }),
      createListing({ city: "Chino", price: 825_000 }),
    ]);
    const secondBody = JSON.stringify([
      createListing({
        city: "Valencia",
        formattedAddress: "Fixture listing two",
        id: "fixture-two",
        price: 840_000,
        zipCode: "91381",
      }),
    ]);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(firstBody, { headers: { "X-Total-Count": "2" } }),
      )
      .mockResolvedValueOnce(
        new Response(secondBody, { headers: { "X-Total-Count": "1" } }),
      );
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_010)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_030);

    const summary = await runRentCastCoverageAudit(
      {
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now,
      },
      {
        searchAreas: [
          defaultRentCastSaleListingsSearchArea,
          stevensonRanchRentCastSaleListingsSearchArea,
        ],
      },
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "address=1065+Brea+Mall",
    );
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("zipCode=");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("zipCode=91381");
    expect(String(fetch.mock.calls[1]?.[0])).not.toContain("address=");
    expect(summary.areas.map((area) => area.areaLabel)).toEqual([
      "Brea radius (20 mi)",
      "ZIP 91381",
    ]);
    expect(summary.areas.map((area) => area.elapsedMilliseconds)).toEqual([
      10, 30,
    ]);
    expect(summary.combined).toMatchObject({
      belowProductionFloorListings: 1,
      coverageGatePassed: true,
      elapsedMilliseconds: 40,
      maximumPrice: 840_000,
      minimumPrice: 775_000,
      nonTargetCityListings: 1,
      resultLimit: 1_000,
      resultLimitMargin: 997,
      returnedPageComplete: true,
      returnedListings: 3,
      totalMatchingListings: 3,
    });
    expect(summary.combined.targetCityListings).toEqual({
      Chino: 1,
      "Chino Hills": 0,
      Corona: 1,
      Eastvale: 0,
      "Jurupa Valley": 0,
    });

    const output = formatRentCastCoverageAuditSummary(summary);
    expect(output).toContain("Audited areas: 2");
    expect(output).toContain("Area 1: Brea radius (20 mi)");
    expect(output).toContain("Area 2: ZIP 91381");
    expect(output).toContain("Combined provider rows before reconciliation");
    expect(output).not.toContain("Fixture listing two");
    expect(output).not.toContain("1065 Brea Mall");
    expect(output).not.toContain("test-secret");
  });

  it("labels an explicitly supplied direct city area without exposing geography details", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([], { headers: { "X-Total-Count": "0" } }),
    );

    const summary = await runRentCastCoverageAudit(
      {
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now: () => 1_000,
      },
      {
        searchAreas: [{ kind: "city", city: "Chino Hills" }],
      },
    );

    const url = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get("city")).toBe("Chino Hills");
    expect((url as URL).searchParams.get("state")).toBe("CA");
    expect((url as URL).searchParams.get("address")).toBeNull();
    expect((url as URL).searchParams.get("radius")).toBeNull();
    expect((url as URL).searchParams.get("zipCode")).toBeNull();
    expect(summary.areas[0]?.areaLabel).toBe("City Chino Hills, CA");
  });

  it("fails the coverage gate when the total reaches the page limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "500" },
      }),
    );

    const summary = await runRentCastCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
    });

    expect(summary.combined.coverageGatePassed).toBe(false);
    expect(summary.combined.resultLimitMargin).toBe(0);
    expect(summary.combined.returnedPageComplete).toBe(false);
    expect(summary.combined.totalMatchingListings).toBe(500);
  });

  it("fails the coverage gate for an incomplete page below the cap", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([createListing()], {
        headers: { "X-Total-Count": "2" },
      }),
    );

    const summary = await runRentCastCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
    });

    expect(summary.combined.coverageGatePassed).toBe(false);
    expect(summary.combined.resultLimitMargin).toBe(498);
    expect(summary.combined.returnedPageComplete).toBe(false);
  });

  it("fails without a partial summary when a later area request fails", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json([createListing()], {
          headers: { "X-Total-Count": "1" },
        }),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(
      runRentCastCoverageAudit(
        {
          environment: { RENTCAST_API_KEY: "test-secret" },
          fetch,
          now: () => 1_000,
        },
        {
          searchAreas: [
            defaultRentCastSaleListingsSearchArea,
            stevensonRanchRentCastSaleListingsSearchArea,
          ],
        },
      ),
    ).rejects.toThrow("failed with status 503");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty explicit area list before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      runRentCastCoverageAudit(
        {
          environment: { RENTCAST_API_KEY: "test-secret" },
          fetch,
          now: () => 1_000,
        },
        { searchAreas: [] },
      ),
    ).rejects.toThrow("RentCast coverage audit search areas were invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates configuration before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      runRentCastCoverageAudit({
        environment: {},
        fetch,
        now: () => 1_000,
      }),
    ).rejects.toThrow(
      "Missing required environment variable: RENTCAST_API_KEY",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

function createListing(
  overrides: Partial<ReturnType<typeof createBaseListing>> = {},
) {
  return { ...createBaseListing(), ...overrides };
}

function createBaseListing() {
  return {
    id: "123-Main-St,-Chino,-CA-91710",
    formattedAddress: "123 Main St, Chino, CA 91710",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Chino",
    state: "CA",
    zipCode: "91710",
    latitude: 34.0122,
    longitude: -117.6889,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    status: "Active",
    price: 825_000,
    listedDate: "2026-08-20T00:00:00.000Z",
    lastSeenDate: "2026-08-21T12:00:00.000Z",
    mlsName: "CRMLS",
    mlsNumber: "FIXTURE",
  };
}
