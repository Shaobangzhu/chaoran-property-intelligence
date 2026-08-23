import type {
  EditableListingSearchCriteria,
  ListingSearchCriteriaResult,
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
      updatedAt: result.updatedAt,
    },
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
