import { describe, expect, it, vi } from "vitest";

import {
  ManualListingNotFoundError,
  ManualListingValidationError,
  SessionAuthenticationRequiredError,
  archiveManualListing,
  createManualListing,
  fetchListings,
  updateManualListing,
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

  it("accepts manual listings with optional property facts", async () => {
    const manualListing = {
      ...listingDto,
      source: "manual",
      sourceListingId: null,
      propertyType: null,
      bedrooms: null,
      bathrooms: null,
      price: null,
      listedDate: null,
    };
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ listings: [manualListing] }),
    );

    await expect(
      fetchListings({ fetchImplementation }),
    ).resolves.toEqual([manualListing]);
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

describe("createManualListing", () => {
  it("posts the editable draft and parses the created listing", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ listing: manualListingDto }, 201),
    );

    await expect(
      createManualListing(manualDraft, { fetchImplementation }),
    ).resolves.toEqual(manualListingDto);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/listings/manual",
      expect.objectContaining({
        body: JSON.stringify(manualDraft),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("returns a bounded field error for rejected manual input", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        {
          error: { code: "INVALID_MANUAL_LISTING", field: "zipCode" },
        },
        400,
      ),
    );

    const request = createManualListing(manualDraft, { fetchImplementation });

    await expect(request).rejects.toBeInstanceOf(ManualListingValidationError);
    await expect(request).rejects.toMatchObject({ field: "zipCode" });
  });

  it("uses a form-level validation error for a malformed request", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ error: { code: "INVALID_REQUEST" } }, 400),
    );

    await expect(
      createManualListing(manualDraft, { fetchImplementation }),
    ).rejects.toMatchObject({ field: null });
  });

  it("reports an expired create session with the shared typed error", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ code: "AUTHENTICATION_REQUIRED" }, 401),
    );

    await expect(
      createManualListing(manualDraft, { fetchImplementation }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
  });

  it("rejects malformed successful responses", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ listing: { ...manualListingDto, latitude: "33.9" } }, 201),
    );

    await expect(
      createManualListing(manualDraft, { fetchImplementation }),
    ).rejects.toThrow("Listings response was invalid");
  });
});

describe("updateManualListing", () => {
  it("patches only supplied editable fields and parses the updated listing", async () => {
    const patch = { city: "Norco", notes: null } as const;
    const updatedListing = {
      ...manualListingDto,
      city: "Norco",
      formattedAddress: "456 Client Way, Norco, CA 92879",
    };
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ listing: updatedListing }),
    );

    await expect(
      updateManualListing(manualListingDto.id, patch, { fetchImplementation }),
    ).resolves.toEqual(updatedListing);
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/listings/${manualListingDto.id}`,
      expect.objectContaining({
        body: JSON.stringify(patch),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      }),
    );
  });

  it("maps update validation, missing listing, and expired session errors", async () => {
    await expect(
      updateManualListing(manualListingDto.id, { city: "" }, {
        fetchImplementation: async () =>
          jsonResponse(
            { error: { code: "INVALID_MANUAL_LISTING", field: "city" } },
            400,
          ),
      }),
    ).rejects.toMatchObject({ field: "city" });

    await expect(
      updateManualListing(manualListingDto.id, { city: "Norco" }, {
        fetchImplementation: async () =>
          jsonResponse({ error: { code: "MANUAL_LISTING_NOT_FOUND" } }, 404),
      }),
    ).rejects.toBeInstanceOf(ManualListingNotFoundError);

    await expect(
      updateManualListing(manualListingDto.id, { city: "Norco" }, {
        fetchImplementation: async () => jsonResponse({}, 401),
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
  });
});

describe("archiveManualListing", () => {
  it("posts to the archive command and accepts an empty success response", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(
      archiveManualListing(manualListingDto.id, { fetchImplementation }),
    ).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/listings/${manualListingDto.id}/archive`,
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
  });

  it("maps missing listings and expired sessions to shared typed errors", async () => {
    await expect(
      archiveManualListing(manualListingDto.id, {
        fetchImplementation: async () => jsonResponse({}, 404),
      }),
    ).rejects.toBeInstanceOf(ManualListingNotFoundError);

    await expect(
      archiveManualListing(manualListingDto.id, {
        fetchImplementation: async () => jsonResponse({}, 401),
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
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

const manualDraft = {
  addressLine1: "456 Client Way",
  city: "Corona",
  state: "CA",
  zipCode: "92879",
  latitude: 33.8753,
  longitude: -117.5664,
  price: 735000,
  status: "Active",
  notes: "Client supplied listing",
} as const;

const manualListingDto = {
  ...listingDto,
  id: "0198c7d2-7668-7775-b0fc-b789690a60d2",
  source: "manual",
  sourceListingId: null,
  formattedAddress: "456 Client Way, Corona, CA 92879",
  addressLine1: "456 Client Way",
  city: "Corona",
  zipCode: "92879",
  latitude: 33.8753,
  longitude: -117.5664,
  price: 735000,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
