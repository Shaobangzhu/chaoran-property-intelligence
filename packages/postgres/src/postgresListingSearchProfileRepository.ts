import {
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ListingSearchProfile,
  type ListingSearchProfileRepositoryPort,
  type SaveListingSearchProfileInput,
  type SaveListingSearchProfileResult,
} from "@chaoran-property-intelligence/application";
import {
  normalizeListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const maximumSafeRevision = Number.MAX_SAFE_INTEGER;

const profileColumns = `
  profile_key,
  schema_version,
  criteria,
  revision,
  applied_revision,
  updated_by_user_id,
  created_at,
  updated_at
`;

const selectPrimaryProfileSql = `
  SELECT ${profileColumns}
  FROM listing_search_profiles
  WHERE profile_key = $1
  LIMIT 1
`;

const lockPrimaryProfileSql = `
  SELECT ${profileColumns}
  FROM listing_search_profiles
  WHERE profile_key = $1
  FOR UPDATE
`;

const updatePrimaryProfileSql = `
  UPDATE listing_search_profiles
  SET
    schema_version = $2,
    criteria = $3::jsonb,
    revision = revision + 1,
    updated_by_user_id = $4,
    updated_at = $5
  WHERE profile_key = $1
    AND revision = $6
  RETURNING ${profileColumns}
`;

export class PostgresListingSearchProfileRepository
  implements ListingSearchProfileRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async findPrimaryProfile(): Promise<ListingSearchProfile | null> {
    const result = await this.database.query(selectPrimaryProfileSql, [
      PRIMARY_LISTING_SEARCH_PROFILE_KEY,
    ]);
    if (result.rows.length === 0) {
      return null;
    }
    return parseRequiredProfile(result);
  }

  async savePrimaryProfile(
    input: SaveListingSearchProfileInput,
  ): Promise<SaveListingSearchProfileResult> {
    const normalizedInput = normalizeSaveInput(input);

    return this.database.transaction(async (connection) => {
      const currentResult = await connection.query(lockPrimaryProfileSql, [
        PRIMARY_LISTING_SEARCH_PROFILE_KEY,
      ]);
      if (currentResult.rows.length === 0) {
        throw new Error("PostgreSQL listing search profile was missing");
      }

      const currentProfile = parseRequiredProfile(currentResult);
      if (currentProfile.revision !== normalizedInput.expectedRevision) {
        return { status: "conflict" };
      }

      if (
        criteriaAreEqual(currentProfile.criteria, normalizedInput.criteria)
      ) {
        return { status: "unchanged", profile: currentProfile };
      }

      if (
        Date.parse(normalizedInput.updatedAt) <
        Date.parse(currentProfile.updatedAt)
      ) {
        throwInvalidPersistenceInput();
      }

      const updateResult = await connection.query(updatePrimaryProfileSql, [
        PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        normalizedInput.criteria.schemaVersion,
        JSON.stringify(normalizedInput.criteria),
        normalizedInput.updatedByUserId,
        normalizedInput.updatedAt,
        normalizedInput.expectedRevision,
      ]);
      const updatedProfile = parseRequiredProfile(updateResult);
      if (
        updatedProfile.revision !== currentProfile.revision + 1 ||
        updatedProfile.appliedRevision !== currentProfile.appliedRevision
      ) {
        return throwInvalidProfileRow();
      }

      return { status: "updated", profile: updatedProfile };
    });
  }
}

function normalizeSaveInput(
  input: SaveListingSearchProfileInput,
): SaveListingSearchProfileInput {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    input.expectedRevision > maximumSafeRevision ||
    !isUuid(input.updatedByUserId) ||
    !isBoundedTimestamp(input.updatedAt)
  ) {
    return throwInvalidPersistenceInput();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria(input.criteria);
  } catch {
    return throwInvalidPersistenceInput();
  }

  return Object.freeze({
    expectedRevision: input.expectedRevision,
    criteria,
    updatedByUserId: input.updatedByUserId,
    updatedAt: input.updatedAt,
  });
}

function parseRequiredProfile(result: SqlQueryResult): ListingSearchProfile {
  if (result.rows.length !== 1) {
    return throwInvalidProfileRow();
  }

  const row = readRecord(result.rows[0]);
  if (
    row.profile_key !== PRIMARY_LISTING_SEARCH_PROFILE_KEY ||
    row.schema_version !== 1
  ) {
    return throwInvalidProfileRow();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria(row.criteria);
  } catch {
    return throwInvalidProfileRow();
  }
  if (criteria.schemaVersion !== row.schema_version) {
    return throwInvalidProfileRow();
  }

  const revision = readPositiveSafeBigint(row.revision);
  const appliedRevision = readPositiveSafeBigint(row.applied_revision);
  if (appliedRevision > revision) {
    return throwInvalidProfileRow();
  }

  const updatedByUserId = readNullableUuid(row.updated_by_user_id);
  const createdAt = readTimestamp(row.created_at);
  const updatedAt = readTimestamp(row.updated_at);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    return throwInvalidProfileRow();
  }

  return Object.freeze({
    profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
    schemaVersion: criteria.schemaVersion,
    criteria,
    revision,
    appliedRevision,
    updatedByUserId,
    createdAt,
    updatedAt,
  });
}

function criteriaAreEqual(
  left: ListingSearchCriteriaV1,
  right: ListingSearchCriteriaV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return throwInvalidProfileRow();
  }
  return value as Record<string, unknown>;
}

function readPositiveSafeBigint(value: unknown): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximumSafeRevision
  ) {
    return throwInvalidProfileRow();
  }
  return parsed;
}

function readNullableUuid(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (!isUuid(value)) {
    return throwInvalidProfileRow();
  }
  return value;
}

function readTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return throwInvalidProfileRow();
  }
  return value.toISOString();
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isBoundedTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function throwInvalidPersistenceInput(): never {
  throw new Error("Listing search profile persistence input was invalid");
}

function throwInvalidProfileRow(): never {
  throw new Error(
    "PostgreSQL listing search profile row did not match the expected schema",
  );
}
