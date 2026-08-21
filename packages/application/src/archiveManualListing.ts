import {
  ManualListingNotFoundError,
  type ManualListingMutationRepositoryPort,
} from "./manualListingRepository.js";

export interface ArchiveManualListingInput {
  listingId: string;
}

export interface ArchiveManualListingOptions {
  repository: ManualListingMutationRepositoryPort;
  now: () => Date;
}

export class ArchiveManualListing {
  constructor(private readonly options: ArchiveManualListingOptions) {}

  async execute(input: ArchiveManualListingInput): Promise<void> {
    if (!isUuid(input.listingId)) {
      throw new ManualListingNotFoundError();
    }

    const now = this.options.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("Manual listing archive clock was invalid");
    }
    const timestamp = now.toISOString();
    const archived = await this.options.repository.archiveManualListing({
      id: input.listingId,
      archivedAt: timestamp,
      updatedAt: timestamp,
    });
    if (!archived) {
      throw new ManualListingNotFoundError();
    }
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
