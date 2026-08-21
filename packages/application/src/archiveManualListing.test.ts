import { describe, expect, it } from "vitest";

import { ArchiveManualListing } from "./archiveManualListing.js";
import type {
  ArchiveManualListingPersistenceInput,
  ManualListingRecord,
  ManualListingMutationRepositoryPort,
  UpdateManualListingPersistenceInput,
} from "./manualListingRepository.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const archivedAt = new Date("2026-08-21T02:00:00.000Z");

describe("ArchiveManualListing", () => {
  it("archives with one server timestamp", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new ArchiveManualListing({
      repository,
      now: () => archivedAt,
    });

    await useCase.execute({ listingId });

    expect(repository.archivedListings).toEqual([
      {
        id: listingId,
        archivedAt: archivedAt.toISOString(),
        updatedAt: archivedAt.toISOString(),
      },
    ]);
  });

  it("uses one not-found outcome for invalid, absent, RentCast, or archived IDs", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new ArchiveManualListing({
      repository,
      now: () => archivedAt,
    });

    await expect(
      useCase.execute({ listingId: "not-a-uuid" }),
    ).rejects.toMatchObject({ name: "ManualListingNotFoundError" });

    repository.archiveResult = false;
    await expect(useCase.execute({ listingId })).rejects.toMatchObject({
      name: "ManualListingNotFoundError",
    });
  });
});

class RecordingManualListingRepository
  implements ManualListingMutationRepositoryPort
{
  archiveResult = true;
  readonly archivedListings: ArchiveManualListingPersistenceInput[] = [];

  async findActiveManualListing(
    _id: string,
  ): Promise<ManualListingRecord | null> {
    throw new Error("Not used");
  }

  async updateManualListing(
    _input: UpdateManualListingPersistenceInput,
  ): Promise<ManualListingRecord | null> {
    throw new Error("Not used");
  }

  async archiveManualListing(
    input: ArchiveManualListingPersistenceInput,
  ): Promise<boolean> {
    this.archivedListings.push(input);
    return this.archiveResult;
  }
}
