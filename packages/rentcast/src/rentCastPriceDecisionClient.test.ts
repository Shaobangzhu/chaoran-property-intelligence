import { describe, expect, it, vi } from "vitest";

import {
  InvalidRentCastPriceDecisionConfigurationError,
  RENTCAST_PRICE_DECISION_CALL_BUDGET,
  RentCastPriceDecisionClient,
  RentCastPriceDecisionRequestError,
  type RentCastPriceDecisionRequestEvent,
} from "./rentCastPriceDecisionClient.js";

const subjectFixture = Object.freeze({
  id: "100-Test-Ave,-Irvine,-CA-92618",
  formattedAddress: "100 Test Ave, Irvine, CA 92618",
  city: "Irvine",
  state: "CA",
  zipCode: "92618",
  latitude: 33.65,
  longitude: -117.74,
  propertyType: "Single Family",
  bedrooms: 4,
  bathrooms: 3,
  squareFootage: 2200,
  lotSize: 5000,
  yearBuilt: 2012,
});

describe("RentCastPriceDecisionClient", () => {
  it("builds the bounded four-endpoint contract and returns only allowlisted fields", async () => {
    const events: RentCastPriceDecisionRequestEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = input as URL;
      if (url.pathname === "/v1/avm/value") {
        return Response.json({
          price: 1_050_000,
          priceRangeLow: 990_000,
          priceRangeHigh: 1_110_000,
          subjectProperty: {
            ...subjectFixture,
            owner: { names: ["must be stripped"] },
          },
          comparables: [{ price: 999_999, listingType: "Standard" }],
        });
      }
      if (url.pathname === "/v1/properties") {
        return Response.json([
          {
            ...subjectFixture,
            id: "200-Fixture-Rd,-Irvine,-CA-92618",
            formattedAddress: "200 Fixture Rd, Irvine, CA 92618",
            latitude: 33.651,
            longitude: -117.741,
            lastSaleDate: "2026-05-10T00:00:00.000Z",
            lastSalePrice: 1_010_000,
            owner: { names: ["must be stripped"] },
          },
        ]);
      }
      if (url.pathname.startsWith("/v1/listings/sale/")) {
        return Response.json({
          id: subjectFixture.id,
          status: "Inactive",
          price: 1_075_000,
          listedDate: "2026-04-01T00:00:00.000Z",
          lastSeenDate: "2026-06-01T12:00:00.000Z",
          daysOnMarket: 61,
          history: {
            "2026-04-01": {
              event: "Sale Listing",
              price: 1_075_000,
              listedDate: "2026-04-01T00:00:00.000Z",
              removedDate: "2026-06-01T00:00:00.000Z",
            },
          },
          listingAgent: { name: "must be stripped" },
        });
      }
      return Response.json({
        zipCode: "92618",
        saleData: {
          lastUpdatedDate: "2026-08-31T00:00:00.000Z",
          medianPrice: 1_025_000,
          medianPricePerSquareFoot: 535.25,
          medianDaysOnMarket: 27,
          totalListings: 45,
          newListings: 8,
          dataByBedrooms: [{ bedrooms: 4, medianPrice: 1_100_000 }],
        },
      });
    });
    const client = new RentCastPriceDecisionClient({
      apiKey: "server-key",
      fetch,
      onRequest: (event) => events.push(event),
      nowMilliseconds: () => 100,
    });
    const address = "100 Test Ave, Irvine, CA 92618";

    const avm = await client.getValueEstimate(address);
    const sales = await client.getRecordedSales(address, "Single Family");
    const listing = await client.getSaleListing(subjectFixture.id);
    const market = await client.getSaleMarket("92618");

    expect(avm).toEqual({
      price: 1_050_000,
      priceRangeLow: 990_000,
      priceRangeHigh: 1_110_000,
      subjectProperty: subjectFixture,
    });
    expect(sales[0]).not.toHaveProperty("owner");
    expect(avm).not.toHaveProperty("comparables");
    expect(listing).not.toHaveProperty("listingAgent");
    expect(market).not.toHaveProperty("dataByBedrooms");

    expect(fetch).toHaveBeenCalledTimes(
      RENTCAST_PRICE_DECISION_CALL_BUDGET.maximumRequestsPerEstimation,
    );
    const urls = fetch.mock.calls.map(([input]) => input as URL);
    expect(urls[0]?.pathname).toBe("/v1/avm/value");
    expect(urls[0]?.searchParams.get("compCount")).toBe("20");
    expect(urls[0]?.searchParams.get("lookupSubjectAttributes")).toBe("true");
    expect(urls[1]?.pathname).toBe("/v1/properties");
    expect(urls[1]?.searchParams.get("radius")).toBe("5");
    expect(urls[1]?.searchParams.get("saleDateRange")).toBe("365");
    expect(urls[1]?.searchParams.get("limit")).toBe("25");
    expect(urls[2]?.pathname).toContain("/v1/listings/sale/");
    expect(urls[3]?.pathname).toBe("/v1/markets");
    expect(urls[3]?.searchParams.get("dataType")).toBe("Sale");
    expect(urls.every((url) => url.searchParams.get("apiKey") === null)).toBe(
      true,
    );
    expect(fetch.mock.calls.every(([, init]) =>
      (init?.headers as Record<string, string>)["X-Api-Key"] === "server-key"
    )).toBe(true);
    expect(events.map(({ endpoint, outcome }) => ({ endpoint, outcome }))).toEqual([
      { endpoint: "avm", outcome: "success" },
      { endpoint: "recorded-sales", outcome: "success" },
      { endpoint: "listing-history", outcome: "success" },
      { endpoint: "market", outcome: "success" },
    ]);
    expect(JSON.stringify({ avm, sales, listing, market })).not.toContain(
      "must be stripped",
    );
  });

  it("treats absent optional listing and market evidence as null", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("not found", { status: 404 }),
    );
    const client = new RentCastPriceDecisionClient({ apiKey: "key", fetch });

    await expect(client.getSaleListing(subjectFixture.id)).resolves.toBeNull();
    await expect(client.getSaleMarket("92618")).resolves.toBeNull();
  });

  it("fails a malformed provider payload without leaking raw values", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ price: "private malformed value" }),
    );
    const client = new RentCastPriceDecisionClient({ apiKey: "key", fetch });

    const error = await client.getValueEstimate("100 Test Ave").catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(RentCastPriceDecisionRequestError);
    expect((error as Error).message).not.toContain("private malformed value");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not retry a provider HTTP failure", async () => {
    const events: RentCastPriceDecisionRequestEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("rate limited", { status: 429 }),
    );
    const client = new RentCastPriceDecisionClient({
      apiKey: "key",
      fetch,
      onRequest: (event) => events.push(event),
    });

    await expect(client.getValueEstimate("100 Test Ave")).rejects.toMatchObject({
      endpoint: "avm",
      reason: "http-error",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "http-error", status: 429 });
  });

  it("enforces one timeout without retrying or exposing the address in telemetry", async () => {
    vi.useFakeTimers();
    try {
      const events: RentCastPriceDecisionRequestEvent[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      );
      const client = new RentCastPriceDecisionClient({
        apiKey: "key",
        fetch,
        timeoutMs: 25,
        onRequest: (event) => events.push(event),
      });

      const request = client.getValueEstimate(
        "100 Private Fixture Ave, Irvine, CA 92618",
      );
      const rejection = expect(request).rejects.toMatchObject({
        endpoint: "avm",
        reason: "timeout",
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(fetch).toHaveBeenCalledOnce();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ endpoint: "avm", outcome: "timeout" });
      expect(JSON.stringify(events)).not.toContain("Private Fixture");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsafe configuration and query values before fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      () => new RentCastPriceDecisionClient({ apiKey: " ", fetch }),
    ).toThrow(InvalidRentCastPriceDecisionConfigurationError);
    const client = new RentCastPriceDecisionClient({ apiKey: "key", fetch });
    await expect(client.getValueEstimate("bad\naddress")).rejects.toThrow(
      InvalidRentCastPriceDecisionConfigurationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
