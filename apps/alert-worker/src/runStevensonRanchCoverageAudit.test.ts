import { describe, expect, it, vi } from "vitest";

import {
  formatStevensonRanchCoverageAuditSummary,
  runStevensonRanchCoverageAudit,
} from "./runStevensonRanchCoverageAudit.js";

describe("runStevensonRanchCoverageAudit", () => {
  it("constructs the bounded ZIP request and summarizes compatible coverage", async () => {
    const listings = [
      createListing({ price: 825_000 }),
      createListing({ bathrooms: 3, bedrooms: 5, price: 800_000 }),
    ];
    const responseBody = JSON.stringify(listings);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(responseBody, {
        headers: { "X-Total-Count": "2" },
      }),
    );
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);

    const summary = await runStevensonRanchCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(input).toBeInstanceOf(URL);
    const url = input as URL;
    expect(url.origin).toBe("https://api.rentcast.io");
    expect(url.pathname).toBe("/v1/listings/sale");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      bathrooms: "2.5:",
      bedrooms: "4:",
      includeTotalCount: "true",
      limit: "500",
      price: "*:850000",
      propertyType: "Single Family",
      state: "CA",
      status: "Active",
      zipCode: "91381",
    });
    expect(url.searchParams.has("address")).toBe(false);
    expect(url.searchParams.has("radius")).toBe(false);
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe(
      "test-secret",
    );

    expect(summary).toEqual({
      cityCounts: { "Stevenson Ranch": 2 },
      coverageGatePassed: true,
      elapsedMilliseconds: 25,
      expectedCityVerified: true,
      expectedZipCodeVerified: true,
      invalidFilterRows: 0,
      propertyTypeCounts: { "Single Family": 2 },
      responseBodyBytes: new TextEncoder().encode(responseBody).byteLength,
      resultLimit: 500,
      resultLimitMargin: 498,
      returnedListings: 2,
      returnedPageComplete: true,
      statusCounts: { Active: 2 },
      totalMatchingListings: 2,
      zipCodeCounts: { "91381": 2 },
    });

    const output = formatStevensonRanchCoverageAuditSummary(summary);
    expect(output).toContain("Coverage gate: PASS");
    expect(output).toContain(
      'City counts: {"Stevenson Ranch":2}',
    );
    expect(output).not.toContain("123 Main St");
    expect(output).not.toContain("FIXTURE-MLS");
    expect(output).not.toContain("test-secret");
    expect(output).not.toContain("api.rentcast.io");
  });

  it.each([undefined, "three", "3.0", "-1", "+3"])(
    "rejects an invalid total-count header: %s",
    async (totalCount) => {
      const headers = new Headers();
      if (totalCount !== undefined) {
        headers.set("X-Total-Count", totalCount);
      }
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json([createListing()], { headers }),
      );

      await expect(
        runStevensonRanchCoverageAudit({
          environment: { RENTCAST_API_KEY: "test-secret" },
          fetch,
          now: () => 1_000,
        }),
      ).rejects.toThrow("did not include a valid X-Total-Count header");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("fails closed when zero results cannot verify the city label", async () => {
    const summary = await runFixture([], "0");

    expect(summary.returnedPageComplete).toBe(true);
    expect(summary.expectedCityVerified).toBe(false);
    expect(summary.expectedZipCodeVerified).toBe(false);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it("fails closed for an incompatible provider city label", async () => {
    const summary = await runFixture(
      [createListing({ city: "Valencia" })],
      "1",
    );

    expect(summary.cityCounts).toEqual({ Valencia: 1 });
    expect(summary.expectedCityVerified).toBe(false);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it("fails closed for a listing outside ZIP 91381", async () => {
    const summary = await runFixture(
      [createListing({ zipCode: "91355" })],
      "1",
    );

    expect(summary.zipCodeCounts).toEqual({ "91355": 1 });
    expect(summary.expectedZipCodeVerified).toBe(false);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it("fails closed when the returned page is incomplete", async () => {
    const summary = await runFixture([createListing()], "2");

    expect(summary.returnedListings).toBe(1);
    expect(summary.totalMatchingListings).toBe(2);
    expect(summary.returnedPageComplete).toBe(false);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it("fails closed when a complete page reaches the result limit", async () => {
    const listings = Array.from({ length: 500 }, () => createListing());
    const summary = await runFixture(listings, "500");

    expect(summary.returnedPageComplete).toBe(true);
    expect(summary.resultLimitMargin).toBe(0);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it.each([
    { state: "NV" },
    { status: "Inactive" },
    { propertyType: "Condo" },
    { price: 850_001 },
    { bedrooms: 3 },
    { bathrooms: 2 },
  ])("fails closed for an invalid filtered row: %o", async (overrides) => {
    const summary = await runFixture([createListing(overrides)], "1");

    expect(summary.invalidFilterRows).toBe(1);
    expect(summary.coverageGatePassed).toBe(false);
  });

  it("rejects an invalid aggregate schema", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([{ ...createListing(), city: null }], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    await expect(
      runStevensonRanchCoverageAudit({
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now: () => 1_000,
      }),
    ).rejects.toThrow("did not match the expected audit schema");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("validates configuration before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      runStevensonRanchCoverageAudit({
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

async function runFixture(
  listings: unknown[],
  totalCount: string,
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(listings, {
      headers: { "X-Total-Count": totalCount },
    }),
  );

  const summary = await runStevensonRanchCoverageAudit({
    environment: { RENTCAST_API_KEY: "test-secret" },
    fetch,
    now: () => 1_000,
  });
  expect(fetch).toHaveBeenCalledOnce();

  return summary;
}

function createListing(
  overrides: Partial<ReturnType<typeof createBaseListing>> = {},
) {
  return { ...createBaseListing(), ...overrides };
}

function createBaseListing() {
  return {
    bathrooms: 2.5,
    bedrooms: 4,
    city: "Stevenson Ranch",
    formattedAddress: "123 Main St, Stevenson Ranch, CA 91381",
    mlsNumber: "FIXTURE-MLS",
    price: 825_000,
    propertyType: "Single Family",
    state: "CA",
    status: "Active",
    zipCode: "91381",
  };
}
