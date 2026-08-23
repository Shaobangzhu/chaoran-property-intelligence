import {
  normalizeListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import {
  normalizeListingSearchProfile,
  type ListingSearchProfile,
  type ListingSearchProfileRepositoryPort,
  type SaveListingSearchProfileInput,
  type SaveListingSearchProfileResult,
} from "./listingSearchProfile.js";

export type FakeListingSearchProfileRepositoryMethod =
  | "findPrimaryProfile"
  | "savePrimaryProfile";

export type FakeListingSearchProfileRepositoryCall =
  | { readonly method: "findPrimaryProfile" }
  | {
      readonly method: "savePrimaryProfile";
      readonly input: SaveListingSearchProfileInput;
    };

export interface FakeListingSearchProfileRepositoryOptions {
  readonly profile?: ListingSearchProfile | null;
  readonly conflictOnNextSave?: boolean;
  readonly failures?: Partial<
    Record<FakeListingSearchProfileRepositoryMethod, Error>
  >;
}

export class FakeListingSearchProfileRepository
  implements ListingSearchProfileRepositoryPort
{
  readonly calls: FakeListingSearchProfileRepositoryCall[] = [];

  private profile: ListingSearchProfile | null;
  private conflictOnNextSave: boolean;
  private readonly failures: Partial<
    Record<FakeListingSearchProfileRepositoryMethod, Error>
  >;
  private unsafeProfileOnFind: unknown | undefined;

  constructor(options: FakeListingSearchProfileRepositoryOptions = {}) {
    this.profile =
      options.profile === undefined || options.profile === null
        ? null
        : cloneProfile(options.profile);
    this.conflictOnNextSave = options.conflictOnNextSave ?? false;
    this.failures = options.failures ?? {};
  }

  get currentProfile(): ListingSearchProfile | null {
    return this.profile === null ? null : cloneProfile(this.profile);
  }

  returnUnsafeProfileOnFind(value: unknown): void {
    this.unsafeProfileOnFind = value;
  }

  async findPrimaryProfile(): Promise<ListingSearchProfile | null> {
    this.calls.push({ method: "findPrimaryProfile" });
    this.throwConfiguredFailure("findPrimaryProfile");
    if (this.unsafeProfileOnFind !== undefined) {
      return this.unsafeProfileOnFind as ListingSearchProfile;
    }
    return this.currentProfile;
  }

  async savePrimaryProfile(
    input: SaveListingSearchProfileInput,
  ): Promise<SaveListingSearchProfileResult> {
    const normalizedCriteria = normalizeListingSearchCriteria(input.criteria);
    const clonedInput = Object.freeze({
      criteria: normalizedCriteria,
      expectedRevision: input.expectedRevision,
      updatedByUserId: input.updatedByUserId,
      updatedAt: input.updatedAt,
    });
    this.calls.push({ method: "savePrimaryProfile", input: clonedInput });
    this.throwConfiguredFailure("savePrimaryProfile");

    if (this.conflictOnNextSave) {
      this.conflictOnNextSave = false;
      return { status: "conflict" };
    }
    if (this.profile === null) {
      throw new Error("Fake listing search profile was missing");
    }
    if (this.profile.revision !== input.expectedRevision) {
      return { status: "conflict" };
    }
    if (criteriaAreEqual(this.profile.criteria, normalizedCriteria)) {
      return { status: "unchanged", profile: cloneProfile(this.profile) };
    }
    if (Date.parse(input.updatedAt) < Date.parse(this.profile.updatedAt)) {
      throw new Error("Fake listing search profile timestamp moved backwards");
    }

    this.profile = normalizeListingSearchProfile({
      ...this.profile,
      criteria: normalizedCriteria,
      revision: this.profile.revision + 1,
      updatedByUserId: input.updatedByUserId,
      updatedAt: input.updatedAt,
    });
    return { status: "updated", profile: cloneProfile(this.profile) };
  }

  private throwConfiguredFailure(
    method: FakeListingSearchProfileRepositoryMethod,
  ): void {
    const failure = this.failures[method];
    if (failure !== undefined) {
      throw failure;
    }
  }
}

function cloneProfile(profile: ListingSearchProfile): ListingSearchProfile {
  return normalizeListingSearchProfile({
    ...profile,
    criteria: {
      ...profile.criteria,
      cities: [...profile.criteria.cities],
    },
  });
}

function criteriaAreEqual(
  left: ListingSearchCriteriaV1,
  right: ListingSearchCriteriaV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
