import { describe, expect, it, vi } from "vitest";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  ListingSearchCriteriaChangedError,
  ListingSearchCriteriaValidationError,
  fetchListingSearchCriteria,
  updateListingSearchCriteria,
} from "./listingSearchCriteriaApi.js";

describe("listing search criteria API", () => {
  it("loads credentials-bound criteria and strictly parses the response", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(responseBody()),
    );

    await expect(
      fetchListingSearchCriteria({ fetchImplementation }),
    ).resolves.toEqual(snapshot());
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/listing-search-criteria",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
  });

  it("loads an explicitly saved six-market response", async () => {
    const sixMarketSnapshot = snapshot({
      criteria: {
        ...snapshot().criteria,
        cities: [
          "Chino",
          "Chino Hills",
          "Eastvale",
          "Corona",
          "Jurupa Valley",
          "Stevenson Ranch",
        ],
      },
      revision: 3,
    });

    await expect(
      fetchListingSearchCriteria({
        fetchImplementation: async () =>
          jsonResponse({ searchCriteria: sixMarketSnapshot }),
      }),
    ).resolves.toEqual(sixMarketSnapshot);
  });

  it("saves only revision and canonical editable criteria", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(responseBody({ revision: 3 })),
    );

    await expect(
      updateListingSearchCriteria(
        {
          expectedRevision: 2,
          criteria: {
            ...snapshot().criteria,
            cities: ["Stevenson Ranch", "Corona", "Chino"],
          },
        },
        { fetchImplementation },
      ),
    ).resolves.toMatchObject({ revision: 3 });

    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedRevision: 2,
      criteria: {
        ...snapshot().criteria,
        cities: ["Chino", "Corona", "Stevenson Ranch"],
      },
    });
    expect(String(init?.body)).not.toContain("state");
    expect(String(init?.body)).not.toContain("status");
    expect(String(init?.body)).not.toContain("schemaVersion");
  });

  it("rejects invalid outbound input before fetch", async () => {
    const fetchImplementation = vi.fn();
    const invalid = {
      expectedRevision: 1,
      criteria: { ...snapshot().criteria, cities: [] },
    };

    await expect(
      updateListingSearchCriteria(invalid, { fetchImplementation }),
    ).rejects.toBeInstanceOf(ListingSearchCriteriaValidationError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [401, SessionAuthenticationRequiredError],
    [400, ListingSearchCriteriaValidationError],
    [409, ListingSearchCriteriaChangedError],
  ])("maps status %i to a stable client error", async (status, ErrorType) => {
    await expect(
      updateListingSearchCriteria(
        { expectedRevision: 1, criteria: snapshot().criteria },
        {
          fetchImplementation: async () =>
            new Response(null, { status: status as number }),
        },
      ),
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it("bounds unavailable failures without reading a private error body", async () => {
    const response = new Response("postgresql://user:password@private/db", {
      status: 500,
    });

    await expect(
      fetchListingSearchCriteria({ fetchImplementation: async () => response }),
    ).rejects.toThrow("Unable to load listing search criteria (500)");
  });

  it.each([
    {},
    { searchCriteria: { ...snapshot(), internal: true } },
    {
      searchCriteria: {
        ...snapshot(),
        criteria: { ...snapshot().criteria, state: "CA" },
      },
    },
    {
      searchCriteria: {
        ...snapshot(),
        criteria: { ...snapshot().criteria, propertyType: "Duplex" },
      },
    },
    { searchCriteria: { ...snapshot(), revision: 0 } },
    { searchCriteria: { ...snapshot(), updatedAt: "not-a-timestamp" } },
  ])("rejects malformed or expanded response %#", async (body) => {
    await expect(
      fetchListingSearchCriteria({
        fetchImplementation: async () => jsonResponse(body),
      }),
    ).rejects.toThrow("Listing search criteria response was invalid");
  });
});

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    criteria: {
      propertyType: "Single Family" as const,
      minimumPrice: 780000,
      maximumPrice: 850000,
      minimumBedrooms: 4,
      minimumBathrooms: 2.5,
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
      ] as const,
    },
    revision: 2,
    updatedAt: "2026-08-22T20:00:00.000Z",
    ...overrides,
  };
}

function responseBody(overrides: Record<string, unknown> = {}) {
  return { searchCriteria: snapshot(overrides) };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
