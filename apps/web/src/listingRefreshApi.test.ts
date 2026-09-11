import { describe, expect, it, vi } from "vitest";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  ListingRefreshRetryRateLimitedError,
  ListingRefreshRetryUnavailableError,
  fetchLatestListingRefresh,
  retryLatestListingRefresh,
} from "./listingRefreshApi.js";

describe("listing refresh API", () => {
  it("loads the latest credentials-bound refresh", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({ refresh: refreshRun() }),
    );

    await expect(
      fetchLatestListingRefresh({ fetchImplementation }),
    ).resolves.toEqual(refreshRun());
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/listing-refresh/latest",
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
  });

  it("accepts an empty refresh history", async () => {
    await expect(
      fetchLatestListingRefresh({
        fetchImplementation: async () => jsonResponse({ refresh: null }),
      }),
    ).resolves.toBeNull();
  });

  it("retries only the confirmed revision and request count", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        refresh: refreshRun({ triggerReason: "manual-retry" }),
        refreshDispatch: "dispatched",
      }),
    );

    await expect(
      retryLatestListingRefresh(
        {
          expectedRevision: 3,
          confirmedPlannedProviderRequestCount: 2,
        },
        { fetchImplementation },
      ),
    ).resolves.toMatchObject({ refreshDispatch: "dispatched" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/listing-refresh/retry",
      expect.objectContaining({
        body: JSON.stringify({
          expectedRevision: 3,
          confirmedPlannedProviderRequestCount: 2,
        }),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it.each([
    [401, SessionAuthenticationRequiredError],
    [409, ListingRefreshRetryUnavailableError],
    [429, ListingRefreshRetryRateLimitedError],
  ])("maps retry status %i to a stable client error", async (status, ErrorType) => {
    await expect(
      retryLatestListingRefresh(
        {
          expectedRevision: 3,
          confirmedPlannedProviderRequestCount: 2,
        },
        {
          fetchImplementation: async () => new Response(null, { status }),
        },
      ),
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it.each([
    { refresh: { ...refreshRun(), privateField: true } },
    {
      refresh: {
        ...refreshRun(),
        selectedMarketCount: 1,
      },
    },
    {
      refresh: {
        ...refreshRun(),
        actualProviderRequestCount: 3,
      },
    },
    {
      refresh: {
        ...refreshRun(),
        requestedAt: "not-a-timestamp",
      },
    },
  ])("rejects malformed refresh response %#", async (body) => {
    await expect(
      fetchLatestListingRefresh({
        fetchImplementation: async () => jsonResponse(body),
      }),
    ).rejects.toThrow("Listing refresh response was invalid");
  });
});

function refreshRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-3",
    requestedRevision: 3,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt: "2026-08-22T20:00:00.000Z",
    startedAt: null,
    completedAt: null,
    selectedMarkets: ["Chino", "Corona"],
    selectedMarketCount: 2,
    plannedProviderRequestCount: 2,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
