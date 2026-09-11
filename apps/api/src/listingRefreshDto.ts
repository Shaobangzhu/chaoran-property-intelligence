import {
  LISTING_REFRESH_LIMITS,
  type CurrentListingInventory,
  type ListingHistoryPage,
  type ListingHistoryQuery,
  type ListingInventoryItem,
  type ListingRefreshRun,
  type RetryLatestListingRefreshInput,
  type RetryLatestListingRefreshResult,
} from "@chaoran-property-intelligence/application";
import {
  isListingMembershipLifecycleState,
  type ListingMembershipLifecycleState,
} from "@chaoran-property-intelligence/domain";

import { toListingSummaryDto } from "./listingDto.js";
import { toListingRefreshRunDto } from "./listingSearchCriteriaDto.js";

const retryKeys = new Set([
  "expectedRevision",
  "confirmedPlannedProviderRequestCount",
]);
const historyQueryKeys = new Set(["lifecycleStates", "cursor", "limit"]);
const defaultHistoryLifecycleStates = Object.freeze([
  "out_of_scope",
  "missing",
  "inactive",
  "sold",
] satisfies readonly ListingMembershipLifecycleState[]);
const defaultHistoryLimit = 25;

export class InvalidListingRefreshRetryRequestError extends Error {
  constructor() {
    super("Listing refresh retry request was invalid");
    this.name = "InvalidListingRefreshRetryRequestError";
  }
}

export class InvalidListingHistoryQueryError extends Error {
  constructor() {
    super("Listing history query was invalid");
    this.name = "InvalidListingHistoryQueryError";
  }
}

export function parseRetryLatestListingRefreshRequest(
  value: unknown,
): RetryLatestListingRefreshInput {
  if (
    !isExactRecord(value, retryKeys) ||
    !isPositiveSafeInteger(value.expectedRevision) ||
    !isPositiveSafeInteger(value.confirmedPlannedProviderRequestCount) ||
    value.confirmedPlannedProviderRequestCount >
      LISTING_REFRESH_LIMITS.maximumProviderRequests
  ) {
    throw new InvalidListingRefreshRetryRequestError();
  }
  return {
    expectedRevision: value.expectedRevision,
    confirmedPlannedProviderRequestCount:
      value.confirmedPlannedProviderRequestCount,
  };
}

export function parseListingHistoryQuery(
  value: unknown,
): ListingHistoryQuery {
  if (!isRecord(value) || !hasOnlyKeys(value, historyQueryKeys)) {
    throw new InvalidListingHistoryQueryError();
  }

  const lifecycleStates = parseLifecycleStates(value.lifecycleStates);
  const cursor = parseCursor(value.cursor);
  const limit = parseLimit(value.limit);
  return {
    lifecycleStates,
    cursor,
    limit,
  };
}

export function toLatestListingRefreshResponse(run: ListingRefreshRun | null) {
  return { refresh: run === null ? null : toListingRefreshRunDto(run) };
}

export function toRetryLatestListingRefreshResponse(
  result: RetryLatestListingRefreshResult,
) {
  return {
    refresh: toListingRefreshRunDto(result.refreshRun),
    refreshDispatch: result.refreshDispatch,
  };
}

export function toCurrentListingInventoryResponse(
  inventory: CurrentListingInventory | null,
) {
  return {
    current:
      inventory === null
        ? null
        : {
            appliedRevision: inventory.appliedRevision,
            refreshedAt: inventory.refreshedAt,
            listings: inventory.items.map(toInventoryListingDto),
          },
  };
}

export function toListingHistoryResponse(page: ListingHistoryPage) {
  return {
    history: {
      listings: page.items.map(toInventoryListingDto),
      nextCursor: page.nextCursor,
    },
  };
}

function toInventoryListingDto(item: ListingInventoryItem) {
  return {
    ...toListingSummaryDto({ id: item.listingId, listing: item.listing }),
    lifecycle: {
      state: item.membership.lifecycleState,
      appliedRevision: item.membership.appliedRevision,
      firstMatchedAt: item.membership.firstMatchedAt,
      lastMatchedAt: item.membership.lastMatchedAt,
      lastServerObservedAt: item.membership.lastServerObservedAt,
      consecutiveCompleteRunAbsenceCount:
        item.membership.consecutiveCompleteRunAbsenceCount,
      inactiveAt: item.membership.inactiveAt,
      explicitProviderStatus: item.membership.explicitProviderStatus,
      explicitProviderStatusObservedAt:
        item.membership.explicitProviderStatusObservedAt,
    },
    acquisitionEligible: item.acquisitionEligible,
    currentDisplayEligible: item.currentDisplayEligible,
  };
}

function parseLifecycleStates(
  value: unknown,
): readonly ListingMembershipLifecycleState[] {
  if (value === undefined) {
    return defaultHistoryLifecycleStates;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidListingHistoryQueryError();
  }
  const states = value.split(",");
  if (
    states.length === 0 ||
    states.some((state) => !isListingMembershipLifecycleState(state)) ||
    new Set(states).size !== states.length
  ) {
    throw new InvalidListingHistoryQueryError();
  }
  return Object.freeze(states as ListingMembershipLifecycleState[]);
}

function parseCursor(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > LISTING_REFRESH_LIMITS.maximumHistoryCursorLength
  ) {
    throw new InvalidListingHistoryQueryError();
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return defaultHistoryLimit;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new InvalidListingHistoryQueryError();
  }
  const limit = Number(value);
  if (
    !Number.isSafeInteger(limit) ||
    limit > LISTING_REFRESH_LIMITS.maximumHistoryPageSize
  ) {
    throw new InvalidListingHistoryQueryError();
  }
  return limit;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isExactRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.size &&
    hasOnlyKeys(value, expectedKeys)
  );
}
