import {
  InvalidManualListingError,
  normalizeManualListingDraft,
  type ManualListingDraftInput,
} from "@chaoran-property-intelligence/domain";

import type {
  ManualListingRecord,
  ManualListingRepositoryPort,
} from "./manualListingRepository.js";

export interface CreateManualListingInput {
  actorUserId: string;
  draft: ManualListingDraftInput;
}

export interface CreateManualListingOptions {
  repository: ManualListingRepositoryPort;
  createId: () => string;
  now: () => Date;
}

export class CreateManualListing {
  private readonly repository: ManualListingRepositoryPort;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: CreateManualListingOptions) {
    this.repository = options.repository;
    this.createId = options.createId;
    this.now = options.now;
  }

  async execute(input: CreateManualListingInput): Promise<ManualListingRecord> {
    if (!isUuid(input.actorUserId)) {
      throw new InvalidManualListingError("actorUserId");
    }

    const id = this.createId();
    if (!isUuid(id)) {
      throw new Error("Manual listing ID factory returned an invalid UUID");
    }

    const normalized = normalizeManualListingDraft(input.draft, this.now());
    const timestamp = normalized.listing.firstDiscoveredAt;

    return this.repository.createManualListing({
      id,
      listing: normalized.listing,
      createdByUserId: input.actorUserId,
      notes: normalized.notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
