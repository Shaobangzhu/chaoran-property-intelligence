import { describe, expect, it, vi } from "vitest";

import {
  defaultRentCastSaleListingsSearchArea,
  defaultRentCastSaleListingsSearchCriteria,
  rentCastSaleListingPropertyTypes,
  RentCastSaleListingsClient,
  type RentCastSaleListingsSearchArea,
  type RentCastSaleListingsSearchCriteria,
} from "./rentCastSaleListingsClient.js";

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
      Response.json([], { headers: { "X-Total-Count": "0" } }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await client.searchSaleListings(
      defaultRentCastSaleListingsSearchCriteria,
      defaultRentCastSaleListingsSearchArea,
    );

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
    expect((url as URL).searchParams.get("includeTotalCount")).toBe("true");
    expect((url as URL).searchParams.get("apiKey")).toBeNull();

    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": "test-api-key",
      },
    });
  });

  it("exports the current Brea radius as the typed default search area", () => {
    expect(defaultRentCastSaleListingsSearchArea).toEqual({
      kind: "radius",
      address: "1065 Brea Mall, Brea, CA 92821",
      radiusMiles: 20,
    });
    expect(Object.isFrozen(defaultRentCastSaleListingsSearchArea)).toBe(true);
  });

  it("builds a custom radius request without a ZIP parameter", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([], { headers: { "X-Total-Count": "0" } }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await client.searchSaleListings(defaultRentCastSaleListingsSearchCriteria, {
      kind: "radius",
      address: "100 Main St, Corona, CA 92882",
      radiusMiles: 12,
    });

    const url = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get("address")).toBe(
      "100 Main St, Corona, CA 92882",
    );
    expect((url as URL).searchParams.get("radius")).toBe("12");
    expect((url as URL).searchParams.get("city")).toBeNull();
    expect((url as URL).searchParams.get("zipCode")).toBeNull();
  });

  it("builds a ZIP request without radius parameters", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([], { headers: { "X-Total-Count": "0" } }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await client.searchSaleListings(defaultRentCastSaleListingsSearchCriteria, {
      kind: "zip",
      zipCode: "91381",
    });

    const url = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get("zipCode")).toBe("91381");
    expect((url as URL).searchParams.get("address")).toBeNull();
    expect((url as URL).searchParams.get("city")).toBeNull();
    expect((url as URL).searchParams.get("radius")).toBeNull();
    expect((url as URL).searchParams.get("state")).toBe("CA");
    expect((url as URL).searchParams.get("status")).toBe("Active");
    expect((url as URL).searchParams.get("limit")).toBe("500");
    expect((url as URL).searchParams.get("includeTotalCount")).toBe("true");
  });

  it("builds a city request with fixed California state and no other geography", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([], { headers: { "X-Total-Count": "0" } }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });
    const searchArea = {
      kind: "city",
      city: "  Chino Hills  ",
    } as const;

    await client.searchSaleListings(
      defaultRentCastSaleListingsSearchCriteria,
      searchArea,
    );

    const url = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get("city")).toBe("Chino Hills");
    expect((url as URL).searchParams.get("state")).toBe("CA");
    expect((url as URL).searchParams.get("address")).toBeNull();
    expect((url as URL).searchParams.get("radius")).toBeNull();
    expect((url as URL).searchParams.get("zipCode")).toBeNull();
    expect(searchArea).toEqual({
      kind: "city",
      city: "  Chino Hills  ",
    });
  });

  it.each([
    null,
    undefined,
    { kind: "radius", address: "", radiusMiles: 20 },
    { kind: "radius", address: "Brea, CA", radiusMiles: 0 },
    { kind: "radius", address: "Brea, CA", radiusMiles: 1.5 },
    {
      kind: "radius",
      address: "Brea, CA",
      radiusMiles: 20,
      city: "Chino",
    },
    { kind: "zip", zipCode: "9138" },
    { kind: "zip", zipCode: "91381-1234" },
    { kind: "zip", zipCode: "91381", address: "Brea, CA" },
    { kind: "city", city: "" },
    { kind: "city", city: " \t " },
    { kind: "city", city: "Chino\nHills" },
    { kind: "city", city: "Chino", zipCode: "91710" },
  ])("rejects an invalid search area before fetch: %o", async (searchArea) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(
      client.searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        searchArea as RentCastSaleListingsSearchArea,
      ),
    ).rejects.toThrow("RentCast sale listings search area was invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns validated sale listings and ignores extra API fields", async () => {
    const responseBody = JSON.stringify([
      {
        ...rentCastListing,
        listingAgent: {
          name: "Should Not Be Used By Telegram MVP",
        },
      },
    ]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(responseBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Total-Count": "1",
        },
      }),
    );
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(
      client.searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ),
    ).resolves.toEqual({
      listings: [rentCastListing],
      responseBodyBytes: new TextEncoder().encode(responseBody).byteLength,
      resultLimit: 500,
      totalCount: 1,
    });
  });

  it.each(rentCastSaleListingPropertyTypes)(
    "projects the %s property type and numeric boundaries into one request",
    async (propertyType) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json([], { headers: { "X-Total-Count": "0" } }),
      );
      const client = new RentCastSaleListingsClient({
        apiKey: "test-api-key",
        fetch,
      });
      const criteria: RentCastSaleListingsSearchCriteria = {
        propertyType,
        maximumPrice: 1_250_000,
        minimumBedrooms: 0,
        minimumBathrooms: 0,
      };

      await client.searchSaleListings(
        criteria,
        defaultRentCastSaleListingsSearchArea,
      );

      expect(fetch).toHaveBeenCalledOnce();
      const url = fetch.mock.calls[0]?.[0];
      expect(url).toBeInstanceOf(URL);
      expect((url as URL).searchParams.get("propertyType")).toBe(propertyType);
      expect((url as URL).searchParams.get("price")).toBe("*:1250000");
      expect((url as URL).searchParams.get("bedrooms")).toBe("0:");
      expect((url as URL).searchParams.get("bathrooms")).toBe("0:");
      expect((url as URL).searchParams.get("includeTotalCount")).toBe("true");
    },
  );

  it("rejects malformed search criteria before fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new RentCastSaleListingsClient({
      apiKey: "test-api-key",
      fetch,
    });

    await expect(
      client.searchSaleListings(
        {
          ...defaultRentCastSaleListingsSearchCriteria,
          minimumBathrooms: 2.25,
        },
        defaultRentCastSaleListingsSearchArea,
      ),
    ).rejects.toThrow("RentCast sale listings search criteria were invalid");
    expect(fetch).not.toHaveBeenCalled();
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
      client.searchSaleListingsForCoverageAudit(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ),
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
        client.searchSaleListingsForCoverageAudit(
          defaultRentCastSaleListingsSearchCriteria,
          defaultRentCastSaleListingsSearchArea,
        ),
      ).rejects.toThrow(
        "RentCast sale listings response did not include a valid X-Total-Count header",
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
      client.searchSaleListingsForCoverageAudit(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ),
    ).rejects.toThrow(
      "RentCast sale listings total count was smaller than the response page",
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

    await expect(
      client.searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        { kind: "city", city: "Corona" },
      ),
    ).rejects.toEqual(
      new Error("RentCast sale listings request failed with status 401"),
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

    await expect(
      client.searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ),
    ).rejects.toThrow(
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

    await expect(
      client.searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      ),
    ).rejects.toThrow(
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

    const search = client.searchSaleListings(
      defaultRentCastSaleListingsSearchCriteria,
      defaultRentCastSaleListingsSearchArea,
    );
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
    const search = client
      .searchSaleListings(
        defaultRentCastSaleListingsSearchCriteria,
        defaultRentCastSaleListingsSearchArea,
      )
      .catch((error: unknown) => {
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
