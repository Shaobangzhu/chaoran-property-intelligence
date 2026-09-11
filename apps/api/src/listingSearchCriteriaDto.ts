import type {
  EditableListingSearchCriteria,
  ListingRefreshDispatchStatus,
  ListingRefreshRun,
  ListingSearchCriteriaResult,
  UpdateListingSearchCriteriaAndQueueRefreshResult,
} from "@chaoran-property-intelligence/application";
import {
  listingSearchCriteriaSchemaVersion,
  listingSearchState,
  listingSearchStatus,
  normalizeListingSearchCriteria,
} from "@chaoran-property-intelligence/domain";

const requestKeys = new Set(["criteria", "expectedRevision"]);
const editableCriteriaKeys = new Set([
  "propertyType",
  "minimumPrice",
  "maximumPrice",
  "minimumBedrooms",
  "minimumBathrooms",
  "cities",
]);

export interface UpdateListingSearchCriteriaRequest {
  readonly expectedRevision: number;
  readonly criteria: EditableListingSearchCriteria;
}

export interface ListingSearchCriteriaResponse {
  readonly searchCriteria: ListingSearchCriteriaResult;
  readonly refresh: ReturnType<typeof toListingRefreshRunDto> | null;
}

export interface UpdateListingSearchCriteriaResponse
  extends ListingSearchCriteriaResponse {
  readonly refreshDispatch: ListingRefreshDispatchStatus;
}

export class InvalidListingSearchCriteriaRequestError extends Error {
  constructor() {
    super("Listing search criteria request was invalid");
    this.name = "InvalidListingSearchCriteriaRequestError";
  }
}

export function parseUpdateListingSearchCriteriaRequest(
  value: unknown,
): UpdateListingSearchCriteriaRequest {
  if (
    !isExactRecord(value, requestKeys) ||
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    !isExactRecord(value.criteria, editableCriteriaKeys)
  ) {
    throw new InvalidListingSearchCriteriaRequestError();
  }

  try {
    const normalized = normalizeListingSearchCriteria({
      schemaVersion: listingSearchCriteriaSchemaVersion,
      state: listingSearchState,
      status: listingSearchStatus,
      propertyType: value.criteria.propertyType,
      minimumPrice: value.criteria.minimumPrice,
      maximumPrice: value.criteria.maximumPrice,
      minimumBedrooms: value.criteria.minimumBedrooms,
      minimumBathrooms: value.criteria.minimumBathrooms,
      cities: value.criteria.cities,
    });

    return {
      expectedRevision: value.expectedRevision,
      criteria: {
        propertyType: normalized.propertyType,
        minimumPrice: normalized.minimumPrice,
        maximumPrice: normalized.maximumPrice,
        minimumBedrooms: normalized.minimumBedrooms,
        minimumBathrooms: normalized.minimumBathrooms,
        cities: normalized.cities,
      },
    };
  } catch {
    throw new InvalidListingSearchCriteriaRequestError();
  }
}

export function toListingSearchCriteriaResponse(
  result: ListingSearchCriteriaResult,
  refresh: ListingRefreshRun | null,
): ListingSearchCriteriaResponse {
  return {
    searchCriteria: {
      criteria: {
        propertyType: result.criteria.propertyType,
        minimumPrice: result.criteria.minimumPrice,
        maximumPrice: result.criteria.maximumPrice,
        minimumBedrooms: result.criteria.minimumBedrooms,
        minimumBathrooms: result.criteria.minimumBathrooms,
        cities: [...result.criteria.cities],
      },
      revision: result.revision,
      appliedRevision: result.appliedRevision,
      updatedAt: result.updatedAt,
    },
    refresh: refresh === null ? null : toListingRefreshRunDto(refresh),
  };
}

export function toUpdateListingSearchCriteriaResponse(
  result: UpdateListingSearchCriteriaAndQueueRefreshResult,
): UpdateListingSearchCriteriaResponse {
  return {
    ...toListingSearchCriteriaResponse(
      result.searchCriteria,
      result.refreshRun,
    ),
    refreshDispatch: result.refreshDispatch,
  };
}

export function toListingRefreshRunDto(run: ListingRefreshRun) {
  return {
    runId: run.runId,
    requestedRevision: run.requestedRevision,
    effectiveRevision: run.effectiveRevision,
    triggerReason: run.triggerReason,
    status: run.status,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    selectedMarkets: [...run.selectedMarkets],
    selectedMarketCount: run.selectedMarketCount,
    plannedProviderRequestCount: run.plannedProviderRequestCount,
    actualProviderRequestCount: run.actualProviderRequestCount,
    returnedListingCount: run.returnedListingCount,
    publishedCurrentCount: run.publishedCurrentCount,
    failureCode: run.failureCode,
    supersededByRunId: run.supersededByRunId,
  };
}

function isExactRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
}
