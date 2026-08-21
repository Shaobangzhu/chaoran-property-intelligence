import type { ManualNormalizedListing } from "@chaoran-property-intelligence/domain";

export interface CreateManualListingPersistenceInput {
  id: string;
  listing: ManualNormalizedListing;
  createdByUserId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualListingRecord
  extends CreateManualListingPersistenceInput {
  archivedAt: string | null;
}

export interface ManualListingRepositoryPort {
  createManualListing(
    input: CreateManualListingPersistenceInput,
  ): Promise<ManualListingRecord>;
}
