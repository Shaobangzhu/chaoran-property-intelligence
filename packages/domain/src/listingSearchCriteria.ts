export const listingPropertyTypes = Object.freeze([
  "Single Family",
  "Condo",
  "Townhouse",
  "Manufactured",
  "Multi-Family",
  "Apartment",
  "Land",
] as const);

export type ListingPropertyType = (typeof listingPropertyTypes)[number];

export const listingSearchCities = Object.freeze([
  "Chino",
  "Chino Hills",
  "Eastvale",
  "Corona",
  "Jurupa Valley",
  "Stevenson Ranch",
] as const);

export type ListingSearchCity = (typeof listingSearchCities)[number];

export const listingSearchCriteriaSchemaVersion = 1 as const;
export const listingSearchState = "CA" as const;
export const listingSearchStatus = "Active" as const;
export const maximumListingSearchPrice = 2_147_483_647;
export const maximumListingSearchBedrooms = 10;
export const maximumListingSearchBathrooms = 10;

export interface ListingSearchCriteriaV1 {
  readonly schemaVersion: typeof listingSearchCriteriaSchemaVersion;
  readonly state: typeof listingSearchState;
  readonly status: typeof listingSearchStatus;
  readonly propertyType: ListingPropertyType;
  readonly minimumPrice: number;
  readonly maximumPrice: number;
  readonly minimumBedrooms: number;
  readonly minimumBathrooms: number;
  readonly cities: readonly ListingSearchCity[];
}

export type ListingSearchCriteriaField =
  | keyof ListingSearchCriteriaV1
  | "criteria";

export class InvalidListingSearchCriteriaError extends Error {
  constructor(readonly field: ListingSearchCriteriaField) {
    super("Listing search criteria were invalid");
    this.name = "InvalidListingSearchCriteriaError";
  }
}

const listingPropertyTypeSet: ReadonlySet<string> = new Set(
  listingPropertyTypes,
);
const listingSearchCitySet: ReadonlySet<string> = new Set(listingSearchCities);
const listingSearchCriteriaKeySet: ReadonlySet<string> = new Set([
  "schemaVersion",
  "state",
  "status",
  "propertyType",
  "minimumPrice",
  "maximumPrice",
  "minimumBedrooms",
  "minimumBathrooms",
  "cities",
]);

export function isListingPropertyType(
  value: unknown,
): value is ListingPropertyType {
  return typeof value === "string" && listingPropertyTypeSet.has(value);
}

export function isListingSearchCity(
  value: unknown,
): value is ListingSearchCity {
  return typeof value === "string" && listingSearchCitySet.has(value);
}

export function normalizeListingSearchCriteria(
  input: unknown,
): ListingSearchCriteriaV1 {
  if (!isPlainObject(input)) {
    throw new InvalidListingSearchCriteriaError("criteria");
  }

  if (Object.keys(input).some((key) => !listingSearchCriteriaKeySet.has(key))) {
    throw new InvalidListingSearchCriteriaError("criteria");
  }

  if (input.schemaVersion !== listingSearchCriteriaSchemaVersion) {
    throw new InvalidListingSearchCriteriaError("schemaVersion");
  }
  if (input.state !== listingSearchState) {
    throw new InvalidListingSearchCriteriaError("state");
  }
  if (input.status !== listingSearchStatus) {
    throw new InvalidListingSearchCriteriaError("status");
  }
  if (!isListingPropertyType(input.propertyType)) {
    throw new InvalidListingSearchCriteriaError("propertyType");
  }

  const minimumPrice = normalizeWholeNumber(
    input.minimumPrice,
    "minimumPrice",
    maximumListingSearchPrice,
  );
  const maximumPrice = normalizeWholeNumber(
    input.maximumPrice,
    "maximumPrice",
    maximumListingSearchPrice,
  );
  if (minimumPrice > maximumPrice) {
    throw new InvalidListingSearchCriteriaError("minimumPrice");
  }

  const minimumBedrooms = normalizeWholeNumber(
    input.minimumBedrooms,
    "minimumBedrooms",
    maximumListingSearchBedrooms,
  );
  const minimumBathrooms = normalizeHalfStepNumber(
    input.minimumBathrooms,
    "minimumBathrooms",
    maximumListingSearchBathrooms,
  );
  const cities = normalizeCities(input.cities);

  return Object.freeze({
    schemaVersion: listingSearchCriteriaSchemaVersion,
    state: listingSearchState,
    status: listingSearchStatus,
    propertyType: input.propertyType,
    minimumPrice,
    maximumPrice,
    minimumBedrooms,
    minimumBathrooms,
    cities,
  });
}

export const defaultListingSearchCriteria = normalizeListingSearchCriteria({
  schemaVersion: listingSearchCriteriaSchemaVersion,
  state: listingSearchState,
  status: listingSearchStatus,
  propertyType: "Single Family",
  minimumPrice: 780000,
  maximumPrice: 850000,
  minimumBedrooms: 4,
  minimumBathrooms: 2.5,
  cities: listingSearchCities,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function normalizeWholeNumber(
  value: unknown,
  field: ListingSearchCriteriaField,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new InvalidListingSearchCriteriaError(field);
  }
  return value;
}

function normalizeHalfStepNumber(
  value: unknown,
  field: ListingSearchCriteriaField,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    !Number.isInteger(value * 2)
  ) {
    throw new InvalidListingSearchCriteriaError(field);
  }
  return value;
}

function normalizeCities(value: unknown): readonly ListingSearchCity[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > listingSearchCities.length
  ) {
    throw new InvalidListingSearchCriteriaError("cities");
  }

  const selectedCities = new Set<ListingSearchCity>();
  for (const city of value) {
    if (!isListingSearchCity(city) || selectedCities.has(city)) {
      throw new InvalidListingSearchCriteriaError("cities");
    }
    selectedCities.add(city);
  }

  return Object.freeze(
    listingSearchCities.filter((city) => selectedCities.has(city)),
  );
}
