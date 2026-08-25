import { describe, expect, it, vi } from "vitest";

import {
  formatIrvineProviderIdentityProbeSummary,
  runIrvineProviderIdentityProbe,
} from "./runIrvineProviderIdentityProbe.js";

describe("runIrvineProviderIdentityProbe", () => {
  it("constructs one active Irvine identity request without product filters", async () => {
    const listings = [createListing(), createListing()];
    const responseBody = JSON.stringify(listings);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(responseBody, {
        headers: { "X-Total-Count": "2" },
      }),
    );
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_020);

    const summary = await runIrvineProviderIdentityProbe({
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
      city: "Irvine",
      includeTotalCount: "true",
      limit: "500",
      state: "CA",
      status: "Active",
    });
    expect(url.searchParams.has("address")).toBe(false);
    expect(url.searchParams.has("bathrooms")).toBe(false);
    expect(url.searchParams.has("bedrooms")).toBe(false);
    expect(url.searchParams.has("price")).toBe(false);
    expect(url.searchParams.has("propertyType")).toBe(false);
    expect(url.searchParams.has("radius")).toBe(false);
    expect(url.searchParams.has("zipCode")).toBe(false);
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe(
      "test-secret",
    );

    expect(summary).toEqual({
      allMatchingRowsReturned: true,
      cityCounts: { Irvine: 2 },
      elapsedMilliseconds: 20,
      expectedCityVerified: true,
      identityGatePassed: true,
      invalidScopeRows: 0,
      responseBodyBytes: new TextEncoder().encode(responseBody).byteLength,
      resultLimit: 500,
      returnedIdentityRows: 2,
      returnedSampleComplete: true,
      sampleLimitSaturated: false,
      totalMatchingActiveListings: 2,
    });

    const output = formatIrvineProviderIdentityProbeSummary(summary);
    expect(output).toContain("Identity gate: PASS");
    expect(output).toContain("Requests completed: 1");
    expect(output).toContain("Expected city verified: yes");
    expect(output).toContain('Provider city counts: {"Irvine":2}');
    expect(output).toContain(
      "Geography evidence only; product inventory completeness was not asserted.",
    );
    expect(output).not.toContain("123 Main St");
    expect(output).not.toContain("FIXTURE-MLS");
    expect(output).not.toContain("test-secret");
    expect(output).not.toContain("api.rentcast.io");
  });

  it("accepts a complete saturated sample as identity evidence only", async () => {
    const listings = Array.from({ length: 500 }, () => createListing());
    const summary = await runFixture(listings, "800");

    expect(summary.returnedIdentityRows).toBe(500);
    expect(summary.returnedSampleComplete).toBe(true);
    expect(summary.sampleLimitSaturated).toBe(true);
    expect(summary.allMatchingRowsReturned).toBe(false);
    expect(summary.identityGatePassed).toBe(true);
  });

  it("fails closed when zero rows cannot verify provider identity", async () => {
    const summary = await runFixture([], "0");

    expect(summary.returnedSampleComplete).toBe(true);
    expect(summary.expectedCityVerified).toBe(false);
    expect(summary.identityGatePassed).toBe(false);
  });

  it("fails closed when the returned identity sample is incomplete", async () => {
    const summary = await runFixture([createListing()], "2");

    expect(summary.returnedSampleComplete).toBe(false);
    expect(summary.identityGatePassed).toBe(false);
  });

  it("fails closed for a provider city other than Irvine", async () => {
    const summary = await runFixture(
      [createListing({ city: "Newport Beach" })],
      "1",
    );

    expect(summary.cityCounts).toEqual({ "Newport Beach": 1 });
    expect(summary.expectedCityVerified).toBe(false);
    expect(summary.identityGatePassed).toBe(false);
  });

  it.each([{ state: "NV" }, { status: "Inactive" }])(
    "fails closed for a row outside the fixed probe scope: %o",
    async (overrides) => {
      const summary = await runFixture([createListing(overrides)], "1");

      expect(summary.invalidScopeRows).toBe(1);
      expect(summary.identityGatePassed).toBe(false);
    },
  );

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
        runIrvineProviderIdentityProbe({
          environment: { RENTCAST_API_KEY: "test-secret" },
          fetch,
          now: () => 1_000,
        }),
      ).rejects.toThrow("did not include a valid X-Total-Count header");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects invalid response data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([{ ...createListing(), status: null }], {
        headers: { "X-Total-Count": "1" },
      }),
    );

    await expect(
      runIrvineProviderIdentityProbe({
        environment: { RENTCAST_API_KEY: "test-secret" },
        fetch,
        now: () => 1_000,
      }),
    ).rejects.toThrow("did not match the expected probe schema");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("validates the API key before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      runIrvineProviderIdentityProbe({
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

async function runFixture(listings: unknown[], totalCount: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(listings, {
      headers: { "X-Total-Count": totalCount },
    }),
  );

  const summary = await runIrvineProviderIdentityProbe({
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
    city: "Irvine",
    formattedAddress: "123 Main St, Irvine, CA 92602",
    mlsNumber: "FIXTURE-MLS",
    state: "CA",
    status: "Active",
  };
}
