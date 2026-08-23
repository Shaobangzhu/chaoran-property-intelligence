import {
  normalizeListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

export const PRIMARY_LISTING_SEARCH_PROFILE_KEY = "primary" as const;

export interface ListingSearchProfile {
  readonly profileKey: typeof PRIMARY_LISTING_SEARCH_PROFILE_KEY;
  readonly schemaVersion: 1;
  readonly criteria: ListingSearchCriteriaV1;
  readonly revision: number;
  readonly appliedRevision: number;
  readonly updatedByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveListingSearchProfileInput {
  readonly expectedRevision: number;
  readonly criteria: ListingSearchCriteriaV1;
  readonly updatedByUserId: string;
  readonly updatedAt: string;
}

export type SaveListingSearchProfileResult =
  | {
      readonly status: "updated" | "unchanged";
      readonly profile: ListingSearchProfile;
    }
  | {
      readonly status: "conflict";
    };

export interface ListingSearchProfileQueryPort {
  findPrimaryProfile(): Promise<ListingSearchProfile | null>;
}

export interface ListingSearchProfileRepositoryPort
  extends ListingSearchProfileQueryPort {
  savePrimaryProfile(
    input: SaveListingSearchProfileInput,
  ): Promise<SaveListingSearchProfileResult>;
}

export class InvalidListingSearchProfileContractError extends Error {
  constructor() {
    super("Listing search profile contract was invalid");
    this.name = "InvalidListingSearchProfileContractError";
  }
}

const profileKeys = new Set([
  "profileKey",
  "schemaVersion",
  "criteria",
  "revision",
  "appliedRevision",
  "updatedByUserId",
  "createdAt",
  "updatedAt",
]);

export function normalizeListingSearchProfile(
  value: unknown,
): ListingSearchProfile {
  if (!isExactRecord(value, profileKeys)) {
    return throwInvalidProfileContract();
  }
  if (
    value.profileKey !== PRIMARY_LISTING_SEARCH_PROFILE_KEY ||
    value.schemaVersion !== 1
  ) {
    return throwInvalidProfileContract();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria(value.criteria);
  } catch {
    return throwInvalidProfileContract();
  }
  if (criteria.schemaVersion !== value.schemaVersion) {
    return throwInvalidProfileContract();
  }

  if (
    !isPositiveSafeInteger(value.revision) ||
    !isPositiveSafeInteger(value.appliedRevision) ||
    value.appliedRevision > value.revision ||
    (value.updatedByUserId !== null && !isUuid(value.updatedByUserId)) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    return throwInvalidProfileContract();
  }

  return Object.freeze({
    profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
    schemaVersion: 1,
    criteria,
    revision: value.revision,
    appliedRevision: value.appliedRevision,
    updatedByUserId: value.updatedByUserId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
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

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function throwInvalidProfileContract(): never {
  throw new InvalidListingSearchProfileContractError();
}
