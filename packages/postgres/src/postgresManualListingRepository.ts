import type {
  CreateManualListingPersistenceInput,
  ManualListingRecord,
  ManualListingRepositoryPort,
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

export class PostgresManualListingRepository
  implements ManualListingRepositoryPort
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
