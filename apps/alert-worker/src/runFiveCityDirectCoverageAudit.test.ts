import { describe, expect, it, vi } from "vitest";

import {
  fiveCityDirectCoverageAuditMarkets,
  formatFiveCityDirectCoverageAuditSummary,
  runFiveCityDirectCoverageAudit,
} from "./runFiveCityDirectCoverageAudit.js";

describe("runFiveCityDirectCoverageAudit", () => {
  it("requests the five reviewed cities in order and emits aggregate-only evidence", async () => {
    const responseBodies: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      const city = url.searchParams.get("city");
      const responseBody = JSON.stringify([
        createListing({ city: city ?? "missing" }),
      ]);
      responseBodies.push(responseBody);
      return new Response(responseBody, {
        headers: { "X-Total-Count": "1" },
      });
    });
    let clock = 0;

    const summary = await runFiveCityDirectCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => {
        clock += 10;
        return clock;
      },
    });

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(
      fetch.mock.calls.map(([input]) => (input as URL).searchParams.get("city")),
    ).toEqual(fiveCityDirectCoverageAuditMarkets);

    for (const [input, init] of fetch.mock.calls) {
      const url = input as URL;
      expect(url.origin).toBe("https://api.rentcast.io");
      expect(url.pathname).toBe("/v1/listings/sale");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        bathrooms: "2.5:",
        bedrooms: "4:",
        city: url.searchParams.get("city"),
        includeTotalCount: "true",
        limit: "500",
        price: "*:850000",
        propertyType: "Single Family",
        state: "CA",
        status: "Active",
      });
      expect(url.searchParams.has("address")).toBe(false);
      expect(url.searchParams.has("radius")).toBe(false);
      expect(url.searchParams.has("zipCode")).toBe(false);
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe(
        "test-secret",
      );
    }

    expect(summary.areas.map((area) => area.market)).toEqual(
      fiveCityDirectCoverageAuditMarkets,
    );
    expect(summary.areas.every((area) => area.coverageGatePassed)).toBe(
      true,
    );
    expect(summary.combined).toEqual({
      cityCounts: {
        Chino: 1,
        "Chino Hills": 1,
        Corona: 1,
        Eastvale: 1,
        "Jurupa Valley": 1,
      },
      coverageGatePassed: true,
      elapsedMilliseconds: 50,
      expectedCitiesVerified: true,
      invalidFilterRows: 0,
      maximumPrice: 825_000,
      minimumPrice: 825_000,
      requestCount: 5,
      responseBodyBytes: responseBodies.reduce(
        (total, body) =>
          total + new TextEncoder().encode(body).byteLength,
        0,
      ),
      resultLimit: 2_500,
      resultLimitMargin: 2_495,
      returnedListings: 5,
      returnedPagesComplete: true,
      totalMatchingListings: 5,
    });

    const output = formatFiveCityDirectCoverageAuditSummary(summary);
    expect(output).toContain("Coverage gate: PASS");
    expect(output).toContain("Requests completed: 5");
    expect(output).toContain("Area 5: Jurupa Valley, CA");
    expect(output).toContain(
      'Provider city counts: {"Chino":1,"Chino Hills":1,"Corona":1,"Eastvale":1,"Jurupa Valley":1}',
    );
    expect(output).not.toContain("123 Main St");
    expect(output).not.toContain("FIXTURE-MLS");
    expect(output).not.toContain("test-secret");
    expect(output).not.toContain("api.rentcast.io");
  });

  it("fails closed when a provider city label does not match its requested market", async () => {
    const summary = await runFixture((city) =>
      createListing({ city: city === "Eastvale" ? "Corona" : city }),
    );

    expect(summary.areas[2]).toMatchObject({
      cityCounts: { Corona: 1 },
      coverageGatePassed: false,
      expectedCityVerified: false,
      market: "Eastvale",
    });
    expect(summary.combined.coverageGatePassed).toBe(false);
    expect(summary.combined.expectedCitiesVerified).toBe(false);
  });

  it("fails closed when one city reaches the 500-row completeness boundary", async () => {
    const fetch = createSequentialFetch((city) => ({
      listings: [createListing({ city })],
      totalCount: city === "Corona" ? "500" : "1",
    }));

    const summary = await runFiveCityDirectCoverageAudit({
      environment: { RENTCAST_API_KEY: "test-secret" },
      fetch,
      now: () => 1_000,
    });

    expect(summary.areas[3]).toMatchObject({
      coverageGatePassed: false,
      market: "Corona",
      resultLimitMargin: 0,
      returnedPageComplete: false,
      totalMatchingListings: 500,
    });
    expect(summary.combined.coverageGatePassed).toBe(false);
    expect(summary.combined.returnedPagesComplete).toBe(false);
  });

  it.each([undefined, "five", "-1", "1.5"])(
    "rejects an invalid total-count header before requesting later cities: %s",
    async (totalCount) => {
      const headers = new Headers();
      if (totalCount !== undefined) {
        headers.set("X-Total-Count", totalCount);
      }
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json([createListing({ city: "Chino" })], { headers }),
      );

      await expect(
        runFiveCityDirectCoverageAudit({
          environment: { RENTCAST_API_KEY: "test-secret" },
          fetch,
          now: () => 1_000,
        }),
      ).rejects.toThrow(
        "RentCast direct city coverage response for Chino did not include a valid X-Total-Count header",
      );
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { state: "NV" },
    { status: "Inactive" },
    { propertyType: "Condo" },
    { price: 850_001 },
    { bedrooms: 3 },
    { bathrooms: 2 },
  ])("fails closed for a provider row outside fixed filters: %o", async (overrides) => {
    const summary = await runFixture((city) =>
      createListing(city === "Chino" ? { city, ...overrides } : { city }),
    );

    expect(summary.areas[0]).toMatchObject({
      coverageGatePassed: false,
      invalidFilterRows: 1,
      market: "Chino",
    });
    expect(summary.combined.coverageGatePassed).toBe(false);
    expect(summary.combined.invalidFilterRows).toBe(1);
  });

  it("stops without retry or a partial summary when a later city request fails", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(createResponse("Chino"))
      .mockResolvedValueOnce(createResponse("Chino Hills"))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(
      runFiveCityDirectCoverageAudit({
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now: () => 1_000,
      }),
    ).rejects.toThrow(
      "RentCast direct city coverage audit for Eastvale failed with status 503",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid aggregate schema and stops before later cities", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([{ ...createListing({ city: "Chino" }), city: null }], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    await expect(
      runFiveCityDirectCoverageAudit({
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now: () => 1_000,
      }),
    ).rejects.toThrow(
      "RentCast direct city coverage response for Chino did not match the expected audit schema",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("validates the API key before making any request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      runFiveCityDirectCoverageAudit({
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
  createCityListing: (
    city: (typeof fiveCityDirectCoverageAuditMarkets)[number],
  ) => ReturnType<typeof createListing>,
) {
  const fetch = createSequentialFetch((city) => ({
    listings: [createCityListing(city)],
    totalCount: "1",
  }));

  const summary = await runFiveCityDirectCoverageAudit({
    environment: { RENTCAST_API_KEY: "test-secret" },
    fetch,
    now: () => 1_000,
  });
  expect(fetch).toHaveBeenCalledTimes(5);
  return summary;
}

function createSequentialFetch(
  createResult: (
    city: (typeof fiveCityDirectCoverageAuditMarkets)[number],
  ) => { listings: unknown[]; totalCount: string },
) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const city = (input as URL).searchParams.get("city");
    if (!isAuditMarket(city)) {
      throw new Error("Unexpected fixture city");
    }
    const result = createResult(city);
    return Response.json(result.listings, {
      headers: { "X-Total-Count": result.totalCount },
    });
  });
}

function createResponse(
  city: (typeof fiveCityDirectCoverageAuditMarkets)[number],
): Response {
  return Response.json([createListing({ city })], {
    headers: { "X-Total-Count": "1" },
  });
}

function isAuditMarket(
  value: string | null,
): value is (typeof fiveCityDirectCoverageAuditMarkets)[number] {
  return (
    value !== null &&
    (fiveCityDirectCoverageAuditMarkets as readonly string[]).includes(value)
  );
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
    city: "Chino",
    formattedAddress: "123 Main St, Chino, CA 91710",
    mlsNumber: "FIXTURE-MLS",
    price: 825_000,
    propertyType: "Single Family",
    state: "CA",
    status: "Active",
  };
}
