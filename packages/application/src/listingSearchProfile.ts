import type { ListingSearchCriteriaV1 } from "@chaoran-property-intelligence/domain";

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
