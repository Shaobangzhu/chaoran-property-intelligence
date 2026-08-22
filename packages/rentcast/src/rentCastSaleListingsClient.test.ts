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
    expect((url as URL).searchParams.get("price")).toBe("*:850000");
    expect((url as URL).searchParams.get("bedrooms")).toBe("4:");
    expect((url as URL).searchParams.get("bathrooms")).toBe("2.5:");
    expect((url as URL).searchParams.get("limit")).toBe("500");
    expect((url as URL).searchParams.get("includeTotalCount")).toBeNull();
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

  it("builds the isolated price-drop coverage audit request", async () => {
    const responseBody = JSON.stringify([rentCastListing]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(responseBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Total-Count": "47",
        },
      }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(
      client.searchSaleListingsForCoverageAudit(),
    ).resolves.toEqual({
      listings: [rentCastListing],
      responseBodyBytes: new TextEncoder().encode(responseBody).byteLength,
      resultLimit: 500,
      totalCount: 47,
    });

    const firstCall = fetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("Expected RentCast fetch to be called");
    }

    const [url, init] = firstCall;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get("address")).toBe(
      "1065 Brea Mall, Brea, CA 92821",
    );
    expect((url as URL).searchParams.get("radius")).toBe("20");
    expect((url as URL).searchParams.get("state")).toBe("CA");
    expect((url as URL).searchParams.get("status")).toBe("Active");
    expect((url as URL).searchParams.get("propertyType")).toBe(
      "Single Family",
    );
    expect((url as URL).searchParams.get("price")).toBe("*:850000");
    expect((url as URL).searchParams.get("bedrooms")).toBe("4:");
    expect((url as URL).searchParams.get("bathrooms")).toBe("2.5:");
    expect((url as URL).searchParams.get("limit")).toBe("500");
    expect((url as URL).searchParams.get("includeTotalCount")).toBe("true");
    expect((url as URL).searchParams.get("apiKey")).toBeNull();
    expect(init).toMatchObject({
      headers: {
        "X-Api-Key": "test-api-key",
      },
    });
  });

  it.each([null, "", "not-a-number", "1.5", "-1"])(
    "rejects an invalid coverage total-count header: %s",
    async (totalCount) => {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (totalCount !== null) {
        headers.set("X-Total-Count", totalCount);
      }

      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        new Response("[]", { headers }),
      );
      const client = new RentCastSaleListingsClient({
        apiKey: "test-api-key",
        fetch,
      });

      await expect(
        client.searchSaleListingsForCoverageAudit(),
      ).rejects.toThrow(
        "RentCast coverage audit response did not include a valid X-Total-Count header",
      );
    },
  );

  it("rejects a coverage count smaller than the returned page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([rentCastListing], {
        headers: { "X-Total-Count": "0" },
      }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(
      client.searchSaleListingsForCoverageAudit(),
    ).rejects.toThrow(
      "RentCast coverage audit total count was smaller than the response page",
    );
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

  it("allows the default production request up to 30 seconds", async () => {
    vi.useFakeTimers();

    let timedOut = false;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });
    const search = client.searchSaleListings().catch((error: unknown) => {
      timedOut = true;
      return error;
    });

    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(timedOut).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      await expect(search).resolves.toEqual(
        new Error("RentCast sale listings request timed out"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
