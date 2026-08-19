import { describe, expect, it, vi } from "vitest";

import { RentCastSaleListingsClient } from "./rentCastSaleListingsClient.js";

describe("RentCastSaleListingsClient", () => {
  const rentCastListing = {
    id: "123-Main-St,-Eastvale,-CA-92880",
    formattedAddress: "123 Main St, Eastvale, CA 92880",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9521,
    longitude: -117.5848,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    status: "Active",
    price: 825000,
    listedDate: "2026-08-17T00:00:00.000Z",
    lastSeenDate: "2026-08-18T13:11:47.157Z",
    mlsName: "CRMLS",
    mlsNumber: "IG26123456",
  };

  it("builds the sale listings request and sends the API key in a header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([]),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await client.searchSaleListings();

    expect(fetch).toHaveBeenCalledOnce();

    const firstCall = fetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("Expected RentCast fetch to be called");
    }

    const [url, init] = firstCall;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).origin).toBe("https://api.rentcast.io");
    expect((url as URL).pathname).toBe("/v1/listings/sale");
    expect((url as URL).searchParams.get("address")).toBe(
      "1065 Brea Mall, Brea, CA 92821",
    );
    expect((url as URL).searchParams.get("radius")).toBe("20");
    expect((url as URL).searchParams.get("state")).toBe("CA");
    expect((url as URL).searchParams.get("status")).toBe("Active");
    expect((url as URL).searchParams.get("propertyType")).toBe(
      "Single Family",
    );
    expect((url as URL).searchParams.get("price")).toBe("780000:850000");
    expect((url as URL).searchParams.get("bedrooms")).toBe("4:");
    expect((url as URL).searchParams.get("bathrooms")).toBe("2.5:");
    expect((url as URL).searchParams.get("limit")).toBe("500");
    expect((url as URL).searchParams.get("apiKey")).toBeNull();

    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": "test-api-key",
      },
    });
  });

  it("returns validated sale listings and ignores extra API fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([
        {
          ...rentCastListing,
          listingAgent: {
            name: "Should Not Be Used By Telegram MVP",
          },
        },
      ]),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(client.searchSaleListings()).resolves.toEqual([
      rentCastListing,
    ]);
  });

  it("throws when RentCast returns a non-2xx response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("Unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(client.searchSaleListings()).rejects.toThrow(
      "RentCast sale listings request failed with status 401",
    );
  });

  it("throws when RentCast returns invalid JSON", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("not json", {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(client.searchSaleListings()).rejects.toThrow(
      "RentCast sale listings response was not valid JSON",
    );
  });

  it("throws when RentCast returns an invalid response shape", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([{ ...rentCastListing, price: "825000" }]),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(client.searchSaleListings()).rejects.toThrow(
      "RentCast sale listings response did not match the expected schema",
    );
  });

  it("throws when the RentCast request times out", async () => {
    vi.useFakeTimers();

    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
      timeoutMs: 1000,
    });

    const search = client.searchSaleListings();
    const expectation = expect(search).rejects.toThrow(
      "RentCast sale listings request timed out",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;

    vi.useRealTimers();
  });
});
