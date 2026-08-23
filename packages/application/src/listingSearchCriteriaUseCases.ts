import {
  listingSearchCriteriaSchemaVersion,
  listingSearchState,
  listingSearchStatus,
  normalizeListingSearchCriteria,
  type ListingPropertyType,
  type ListingSearchCity,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import {
  normalizeListingSearchProfile,
  type ListingSearchProfile,
  type ListingSearchProfileQueryPort,
  type ListingSearchProfileRepositoryPort,
} from "./listingSearchProfile.js";

export interface EditableListingSearchCriteria {
  readonly propertyType: ListingPropertyType;
  readonly minimumPrice: number;
  readonly maximumPrice: number;
  readonly minimumBedrooms: number;
  readonly minimumBathrooms: number;
  readonly cities: readonly ListingSearchCity[];
}

export interface ListingSearchCriteriaResult {
  readonly criteria: EditableListingSearchCriteria;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface UpdateListingSearchCriteriaInput {
  readonly actorUserId: string;
  readonly expectedRevision: number;
  readonly criteria: EditableListingSearchCriteria;
}

export interface UpdateListingSearchCriteriaOptions {
  readonly repository: ListingSearchProfileRepositoryPort;
  readonly now: () => Date;
}

export class InvalidListingSearchCriteriaInputError extends Error {
  constructor() {
    super("Listing search criteria input was invalid");
    this.name = "InvalidListingSearchCriteriaInputError";
  }
}

export class ListingSearchCriteriaChangedError extends Error {
  constructor() {
    super("Listing search criteria changed");
    this.name = "ListingSearchCriteriaChangedError";
  }
}

export class ListingSearchProfileUnavailableError extends Error {
  constructor() {
    super("Listing search profile was unavailable");
    this.name = "ListingSearchProfileUnavailableError";
  }
}

export class InvalidListingSearchCriteriaResultError extends Error {
  constructor() {
    super("Listing search criteria result was invalid");
    this.name = "InvalidListingSearchCriteriaResultError";
  }
}

export class GetListingSearchCriteria {
  constructor(private readonly repository: ListingSearchProfileQueryPort) {}

  async execute(): Promise<ListingSearchCriteriaResult> {
    const profile = await this.repository.findPrimaryProfile();
    if (profile === null) {
      throw new ListingSearchProfileUnavailableError();
    }
    return projectCriteria(requireValidProfile(profile));
  }
}

export class UpdateListingSearchCriteria {
  constructor(private readonly options: UpdateListingSearchCriteriaOptions) {}

  async execute(
    input: UpdateListingSearchCriteriaInput,
  ): Promise<ListingSearchCriteriaResult> {
    const normalizedInput = normalizeUpdateInput(input);
    const updatedAt = readClock(this.options.now);
    const persistenceResult = await this.options.repository.savePrimaryProfile({
      criteria: normalizedInput.criteria,
      expectedRevision: normalizedInput.expectedRevision,
      updatedByUserId: normalizedInput.actorUserId,
      updatedAt,
    });

    if (persistenceResult.status === "conflict") {
      throw new ListingSearchCriteriaChangedError();
    }

    const profile = requireValidProfile(persistenceResult.profile);
    assertExpectedSaveResult(profile, {
      actorUserId: normalizedInput.actorUserId,
      criteria: normalizedInput.criteria,
      expectedRevision: normalizedInput.expectedRevision,
      status: persistenceResult.status,
      updatedAt,
    });
    return projectCriteria(profile);
  }
}

const updateInputKeys = new Set([
  "actorUserId",
  "expectedRevision",
  "criteria",
]);
const editableCriteriaKeys = new Set([
  "propertyType",
  "minimumPrice",
  "maximumPrice",
  "minimumBedrooms",
  "minimumBathrooms",
  "cities",
]);

function normalizeUpdateInput(input: unknown): {
  actorUserId: string;
  expectedRevision: number;
  criteria: ListingSearchCriteriaV1;
} {
  if (
    !isExactRecord(input, updateInputKeys) ||
    !isUuid(input.actorUserId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    typeof input.expectedRevision !== "number" ||
    input.expectedRevision < 1 ||
    !isExactRecord(input.criteria, editableCriteriaKeys)
  ) {
    throw new InvalidListingSearchCriteriaInputError();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria({
      schemaVersion: listingSearchCriteriaSchemaVersion,
      state: listingSearchState,
      status: listingSearchStatus,
      propertyType: input.criteria.propertyType,
      minimumPrice: input.criteria.minimumPrice,
      maximumPrice: input.criteria.maximumPrice,
      minimumBedrooms: input.criteria.minimumBedrooms,
      minimumBathrooms: input.criteria.minimumBathrooms,
      cities: input.criteria.cities,
    });
  } catch {
    throw new InvalidListingSearchCriteriaInputError();
  }

  return Object.freeze({
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    criteria,
  });
}

function requireValidProfile(value: unknown): ListingSearchProfile {
  try {
    return normalizeListingSearchProfile(value);
  } catch {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

function assertExpectedSaveResult(
  profile: ListingSearchProfile,
  expected: {
    actorUserId: string;
    criteria: ListingSearchCriteriaV1;
    expectedRevision: number;
    status: "updated" | "unchanged";
    updatedAt: string;
  },
): void {
  if (!criteriaAreEqual(profile.criteria, expected.criteria)) {
    throw new InvalidListingSearchCriteriaResultError();
  }

  if (expected.status === "unchanged") {
    if (profile.revision !== expected.expectedRevision) {
      throw new InvalidListingSearchCriteriaResultError();
    }
    return;
  }

  if (
    profile.revision !== expected.expectedRevision + 1 ||
    profile.appliedRevision > expected.expectedRevision ||
    profile.updatedByUserId !== expected.actorUserId ||
    profile.updatedAt !== expected.updatedAt
  ) {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

function projectCriteria(
  profile: ListingSearchProfile,
): ListingSearchCriteriaResult {
  return Object.freeze({
    criteria: Object.freeze({
      propertyType: profile.criteria.propertyType,
      minimumPrice: profile.criteria.minimumPrice,
      maximumPrice: profile.criteria.maximumPrice,
      minimumBedrooms: profile.criteria.minimumBedrooms,
      minimumBathrooms: profile.criteria.minimumBathrooms,
      cities: Object.freeze([...profile.criteria.cities]),
    }),
    revision: profile.revision,
    updatedAt: profile.updatedAt,
  });
}

function criteriaAreEqual(
  left: ListingSearchCriteriaV1,
  right: ListingSearchCriteriaV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Listing search criteria clock was invalid");
  }
  return value.toISOString();
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
