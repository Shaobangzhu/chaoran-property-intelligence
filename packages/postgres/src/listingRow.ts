import type { NormalizedListing } from "@chaoran-property-intelligence/domain";

export const normalizedListingColumns = [
  "source",
  "source_listing_id",
  "mls_name",
  "mls_number",
  "formatted_address",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "zip_code",
  "latitude",
  "longitude",
  "property_type",
  "bedrooms",
  "bathrooms",
  "price",
  "status",
  "listed_date",
  "last_seen_date",
  "first_discovered_at",
].join(",\n  ");

export function parseNormalizedListing(
  row: Record<string, unknown>,
): NormalizedListing {
  const source = readString(row, "source");
  const sharedFields = {
    mlsName: readNullableString(row, "mls_name"),
    mlsNumber: readNullableString(row, "mls_number"),
    formattedAddress: readString(row, "formatted_address"),
    addressLine1: readString(row, "address_line_1"),
    addressLine2: readNullableString(row, "address_line_2"),
    city: readString(row, "city"),
    state: readString(row, "state"),
    zipCode: readString(row, "zip_code"),
    latitude: readNumber(row, "latitude"),
    longitude: readNumber(row, "longitude"),
    status: readString(row, "status"),
    lastSeenDate: readString(row, "last_seen_date"),
    firstDiscoveredAt: readString(row, "first_discovered_at"),
  };

  if (source === "rentcast") {
    return {
      ...sharedFields,
      source,
      sourceListingId: readString(row, "source_listing_id"),
      propertyType: readString(row, "property_type"),
      bedrooms: readNumber(row, "bedrooms"),
      bathrooms: readNumber(row, "bathrooms"),
      price: readNumber(row, "price"),
      listedDate: readString(row, "listed_date"),
    };
  }

  if (source === "manual") {
    readNull(row, "source_listing_id");

    return {
      ...sharedFields,
      source,
      sourceListingId: null,
      propertyType: readNullableString(row, "property_type"),
      bedrooms: readNullableNumber(row, "bedrooms"),
      bathrooms: readNullableNumber(row, "bathrooms"),
      price: readNullableNumber(row, "price"),
      listedDate: readNullableString(row, "listed_date"),
    };
  }

  throwInvalidListingRowError();
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwInvalidListingRowError();
  }

  return value as Record<string, unknown>;
}

export function readString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throwInvalidListingRowError();
  }

  return value;
}

export function throwInvalidListingRowError(): never {
  throw new Error("PostgreSQL listing row did not match the expected schema");
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null || typeof value === "string") {
    return value;
  }

  throwInvalidListingRowError();
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalidListingRowError();
  }

  return value;
}

function readNullableNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (value === null) {
    return null;
  }

  return readNumber(record, key);
}

function readNull(record: Record<string, unknown>, key: string): void {
  if (record[key] !== null) {
    throwInvalidListingRowError();
  }
}
