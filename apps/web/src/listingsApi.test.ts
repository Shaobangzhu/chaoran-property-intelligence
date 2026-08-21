import { describe, expect, it, vi } from "vitest";

import {
  SessionAuthenticationRequiredError,
  fetchListings,
} from "./listingsApi.js";

describe("fetchListings", () => {
  it("requests and parses listing DTOs", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ listings: [listingDto] }),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).resolves.toEqual([listingDto]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/listings",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("reports an expired browser session with a typed error", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ error: "unauthorized" }, 401),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
  });

  it("rejects unsuccessful responses without exposing their body", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        { error: "postgresql://user:password@private-host/database" },
        503,
      ),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).rejects.toThrow("Unable to load listings (503)");
  });

  it("rejects malformed listing DTOs", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        listings: [{ ...listingDto, longitude: "-117.5848" }],
      }),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).rejects.toThrow("Listings response was invalid");
  });

  it("rejects invalid JSON", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("not-json", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).rejects.toThrow("Listings response was invalid");
  });
});

const listingDto = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  source: "rentcast",
  sourceListingId: "rentcast-listing-id",
  mlsName: "CRMLS",
  mlsNumber: "IG26000001",
  formattedAddress: "123 Main St, Eastvale, CA 92880",
  addressLine1: "123 Main St",
  addressLine2: null,
  city: "Eastvale",
  state: "CA",
  zipCode: "92880",
  latitude: 33.9525,
  longitude: -117.5848,
  propertyType: "Single Family",
  bedrooms: 4,
  bathrooms: 2.5,
  price: 825000,
  status: "Active",
  listedDate: "2026-08-19",
  lastSeenDate: "2026-08-19",
  firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
