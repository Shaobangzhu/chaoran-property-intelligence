import { describe, expect, it, vi } from "vitest";

import {
  formatRentCastCoverageAuditSummary,
  runRentCastCoverageAudit,
} from "./runRentCastCoverageAudit.js";

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

    expect(summary).toEqual({
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
    });

    const output = formatRentCastCoverageAuditSummary(summary);
    expect(output).toContain("Coverage gate: PASS");
    expect(output).toContain("Below $780,000: 2");
    expect(output).toContain("Returned price range: $700,000 to $825,000");
    expect(output).not.toContain("123 Main St");
    expect(output).not.toContain("test-secret");
    expect(output).not.toContain("api.rentcast.io");
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

    expect(summary.coverageGatePassed).toBe(false);
    expect(summary.resultLimitMargin).toBe(0);
    expect(summary.returnedPageComplete).toBe(false);
    expect(summary.totalMatchingListings).toBe(500);
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

    expect(summary.coverageGatePassed).toBe(false);
    expect(summary.resultLimitMargin).toBe(498);
    expect(summary.returnedPageComplete).toBe(false);
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
