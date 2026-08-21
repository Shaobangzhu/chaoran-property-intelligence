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

export interface UpdateManualListingPersistenceInput {
  id: string;
  listing: ManualNormalizedListing;
  notes: string | null;
  updatedAt: string;
}

export interface ArchiveManualListingPersistenceInput {
  id: string;
  archivedAt: string;
  updatedAt: string;
}

export interface ManualListingRepositoryPort {
  createManualListing(
    input: CreateManualListingPersistenceInput,
  ): Promise<ManualListingRecord>;
}

export interface ManualListingMutationRepositoryPort {
  findActiveManualListing(id: string): Promise<ManualListingRecord | null>;
  updateManualListing(
    input: UpdateManualListingPersistenceInput,
  ): Promise<ManualListingRecord | null>;
  archiveManualListing(
    input: ArchiveManualListingPersistenceInput,
  ): Promise<boolean>;
}

export class ManualListingNotFoundError extends Error {
  constructor() {
    super("Manual listing was not found");
    this.name = "ManualListingNotFoundError";
  }
}
