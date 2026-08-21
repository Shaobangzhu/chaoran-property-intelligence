import type {
  ArchiveManualListingPersistenceInput,
  CreateManualListingPersistenceInput,
  ManualListingRecord,
  ManualListingMutationRepositoryPort,
  ManualListingRepositoryPort,
  UpdateManualListingPersistenceInput,
} from "@chaoran-property-intelligence/application";

import {
  normalizedListingColumns,
  parseNormalizedListing,
  readRecord,
  readString,
} from "./listingRow.js";
import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

const manualListingColumns = `
  id,
  deduplication_key,
  ${normalizedListingColumns},
  notification_status,
  created_by_user_id,
  notes,
  archived_at,
  created_at,
  updated_at
`;

const insertManualListingSql = `
  INSERT INTO listings (${manualListingColumns})
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26, $27, $28
  )
  RETURNING
    id,
    ${normalizedListingColumns},
    created_by_user_id,
    notes,
    archived_at,
    created_at,
    updated_at
`;

const selectActiveManualListingSql = `
  SELECT
    id,
    ${normalizedListingColumns},
    created_by_user_id,
    notes,
    archived_at,
    created_at,
    updated_at
  FROM listings
  WHERE id = $1 AND source = 'manual' AND archived_at IS NULL
`;

const updateManualListingSql = `
  UPDATE listings
  SET
    mls_name = $2,
    mls_number = $3,
    formatted_address = $4,
    address_line_1 = $5,
    address_line_2 = $6,
    city = $7,
    state = $8,
    zip_code = $9,
    latitude = $10,
    longitude = $11,
    property_type = $12,
    bedrooms = $13,
    bathrooms = $14,
    price = $15,
    status = $16,
    listed_date = $17,
    notes = $18,
    updated_at = $19
  WHERE id = $1 AND source = 'manual' AND archived_at IS NULL
  RETURNING
    id,
    ${normalizedListingColumns},
    created_by_user_id,
    notes,
    archived_at,
    created_at,
    updated_at
`;

const archiveManualListingSql = `
  UPDATE listings
  SET archived_at = $2, updated_at = $3
  WHERE id = $1 AND source = 'manual' AND archived_at IS NULL
  RETURNING id
`;

export class PostgresManualListingRepository
  implements ManualListingRepositoryPort, ManualListingMutationRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async createManualListing(
    input: CreateManualListingPersistenceInput,
  ): Promise<ManualListingRecord> {
    const listing = input.listing;
    const result = await this.database.query(insertManualListingSql, [
      input.id,
      `manual:${input.id}`,
      listing.source,
      listing.sourceListingId,
      listing.mlsName,
      listing.mlsNumber,
      listing.formattedAddress,
      listing.addressLine1,
      listing.addressLine2,
      listing.city,
      listing.state,
      listing.zipCode,
      listing.latitude,
      listing.longitude,
      listing.propertyType,
      listing.bedrooms,
      listing.bathrooms,
      listing.price,
      listing.status,
      listing.listedDate,
      listing.lastSeenDate,
      listing.firstDiscoveredAt,
      "not_applicable",
      input.createdByUserId,
      input.notes,
      null,
      input.createdAt,
      input.updatedAt,
    ]);

    return parseManualListingRecord(result);
  }

  async findActiveManualListing(
    id: string,
  ): Promise<ManualListingRecord | null> {
    const result = await this.database.query(selectActiveManualListingSql, [id]);
    return result.rows.length === 0 ? null : parseManualListingRecord(result);
  }

  async updateManualListing(
    input: UpdateManualListingPersistenceInput,
  ): Promise<ManualListingRecord | null> {
    const listing = input.listing;
    const result = await this.database.query(updateManualListingSql, [
      input.id,
      listing.mlsName,
      listing.mlsNumber,
      listing.formattedAddress,
      listing.addressLine1,
      listing.addressLine2,
      listing.city,
      listing.state,
      listing.zipCode,
      listing.latitude,
      listing.longitude,
      listing.propertyType,
      listing.bedrooms,
      listing.bathrooms,
      listing.price,
      listing.status,
      listing.listedDate,
      input.notes,
      input.updatedAt,
    ]);
    return result.rows.length === 0 ? null : parseManualListingRecord(result);
  }

  async archiveManualListing(
    input: ArchiveManualListingPersistenceInput,
  ): Promise<boolean> {
    const result = await this.database.query(archiveManualListingSql, [
      input.id,
      input.archivedAt,
      input.updatedAt,
    ]);
    if (result.rows.length === 0) {
      return false;
    }
    if (
      result.rows.length !== 1 ||
      readString(readRecord(result.rows[0]), "id") !== input.id
    ) {
      throwInvalidManualListingRowError();
    }
    return true;
  }
}

function parseManualListingRecord(
  result: SqlQueryResult,
): ManualListingRecord {
  if (result.rows.length !== 1) {
    throwInvalidManualListingRowError();
  }

  try {
    const row = readRecord(result.rows[0]);
    const listing = parseNormalizedListing(row);
    if (listing.source !== "manual" || row.archived_at !== null) {
      throwInvalidManualListingRowError();
    }

    return {
      id: readNonEmptyString(row, "id"),
      listing,
      createdByUserId: readNonEmptyString(row, "created_by_user_id"),
      notes: readNullableString(row, "notes"),
      archivedAt: null,
      createdAt: readTimestamp(row, "created_at"),
      updatedAt: readTimestamp(row, "updated_at"),
    };
  } catch {
    return throwInvalidManualListingRowError();
  }
}

function readNonEmptyString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = readString(row, key);
  if (value.length === 0) {
    throwInvalidManualListingRowError();
  }
  return value;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value === null || typeof value === "string") {
    return value;
  }
  throwInvalidManualListingRowError();
}

function readTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throwInvalidManualListingRowError();
  }
  return value.toISOString();
}

function throwInvalidManualListingRowError(): never {
  throw new Error(
    "PostgreSQL manual listing row did not match the expected schema",
  );
}
