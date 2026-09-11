import type {
  CurrentListingInventory,
  ListingHistoryPage,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  InvalidListingHistoryQueryError,
  InvalidListingRefreshRetryRequestError,
  parseListingHistoryQuery,
  parseRetryLatestListingRefreshRequest,
  toCurrentListingInventoryResponse,
  toListingHistoryResponse,
} from "./listingRefreshDto.js";

describe("listing refresh DTO", () => {
  it("parses a strict, bounded retry confirmation", () => {
    expect(
      parseRetryLatestListingRefreshRequest({
        expectedRevision: 4,
        confirmedPlannedProviderRequestCount: 2,
      }),
    ).toEqual({
      expectedRevision: 4,
      confirmedPlannedProviderRequestCount: 2,
    });
  });

  it.each([
    {},
    { expectedRevision: 4, confirmedPlannedProviderRequestCount: 0 },
    { expectedRevision: 4, confirmedPlannedProviderRequestCount: 8 },
    {
      expectedRevision: 4,
      confirmedPlannedProviderRequestCount: 2,
      retry: true,
    },
  ])("rejects an invalid retry request: %o", (value) => {
    expect(() => parseRetryLatestListingRefreshRequest(value)).toThrow(
      InvalidListingRefreshRetryRequestError,
    );
  });

  it("parses lifecycle filters, cursor, and a bounded page size", () => {
    expect(
      parseListingHistoryQuery({
        lifecycleStates: "missing,inactive",
        cursor: "opaque-cursor",
        limit: "50",
      }),
    ).toEqual({
      lifecycleStates: ["missing", "inactive"],
      cursor: "opaque-cursor",
      limit: 50,
    });
    expect(parseListingHistoryQuery({})).toEqual({
      lifecycleStates: ["out_of_scope", "missing", "inactive", "sold"],
      cursor: null,
      limit: 25,
    });
  });

  it.each([
    { lifecycleStates: ["missing"] },
    { lifecycleStates: "missing,missing" },
    { lifecycleStates: "unknown" },
    { cursor: "" },
    { limit: "0" },
    { limit: "101" },
    { unexpected: "value" },
  ])("rejects an invalid history query: %o", (value) => {
    expect(() => parseListingHistoryQuery(value)).toThrow(
      InvalidListingHistoryQueryError,
    );
  });

  it("projects current and historical inventory without persistence-only IDs", () => {
    const current: CurrentListingInventory = {
      profileKey: "primary",
      appliedRevision: 3,
      refreshedAt: "2026-09-10T15:00:00.000Z",
      items: [createInventoryItem("current")],
    };
    const history: ListingHistoryPage = {
      items: [createInventoryItem("missing")],
      nextCursor: "next",
    };

    const currentResponse = toCurrentListingInventoryResponse(current);
    const historyResponse = toListingHistoryResponse(history);

    expect(currentResponse).toMatchObject({
      current: {
        appliedRevision: 3,
        listings: [
          {
            id: listingId,
            lifecycle: { state: "current", appliedRevision: 3 },
          },
        ],
      },
    });
    expect(historyResponse).toMatchObject({
      history: {
        listings: [{ lifecycle: { state: "missing" } }],
        nextCursor: "next",
      },
    });
    expect(JSON.stringify(currentResponse)).not.toContain("profileKey");
    expect(JSON.stringify(currentResponse)).not.toContain(
      "lastSuccessfulRunId",
    );
  });
});

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60d1";

function createInventoryItem(state: "current" | "missing") {
  return {
    listingId,
    listing: {
      source: "rentcast" as const,
      sourceListingId: "provider-id",
      mlsName: "CRMLS",
      mlsNumber: "PW26000001",
      formattedAddress: "123 Main St, Corona, CA 92879",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Corona",
      state: "CA",
      zipCode: "92879",
      latitude: 33.8753,
      longitude: -117.5664,
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      price: 825000,
      status: "Active",
      listedDate: "2026-09-01",
      lastSeenDate: "2026-09-10",
      firstDiscoveredAt: "2026-09-01T15:00:00.000Z",
    },
    membership: {
      profileKey: "primary" as const,
      listingId,
      appliedRevision: 3,
      lastSuccessfulRunId: "0198c7d2-7668-7775-b0fc-b789690a60d2",
      lifecycleState: state,
      firstMatchedAt: "2026-09-01T15:00:00.000Z",
      lastMatchedAt: "2026-09-09T15:00:00.000Z",
      lastServerObservedAt: "2026-09-10T15:00:00.000Z",
      consecutiveCompleteRunAbsenceCount: state === "missing" ? 1 : 0,
      inactiveAt: null,
      explicitProviderStatus: null,
      explicitProviderStatusObservedAt: null,
    },
    acquisitionEligible: true,
    currentDisplayEligible: state === "current",
  };
}
