import { describe, expect, it } from "vitest";

import { UpdateManualListing } from "./updateManualListing.js";
import type {
  ArchiveManualListingPersistenceInput,
  ManualListingRecord,
  ManualListingMutationRepositoryPort,
  UpdateManualListingPersistenceInput,
} from "./manualListingRepository.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const updatedAt = new Date("2026-08-21T01:30:00.000Z");

describe("UpdateManualListing", () => {
  it("merges a partial patch while preserving private notes", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new UpdateManualListing({ repository, now: () => updatedAt });

    const result = await useCase.execute({
      listingId,
      patch: {
        addressLine1: "456 Client Way",
        city: "Corona",
        price: 735000,
      },
    });

    expect(repository.updatedListings).toEqual([
      {
        id: listingId,
        listing: expect.objectContaining({
          addressLine1: "456 Client Way",
          city: "Corona",
          formattedAddress: "456 Client Way, Corona, CA 92880",
          price: 735000,
          source: "manual",
        }),
        notes: "Existing private note",
        updatedAt: updatedAt.toISOString(),
      },
    ]);
    expect(result).toEqual(repository.updatedRecord);
  });

  it("clears optional facts and notes only when null is explicit", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new UpdateManualListing({ repository, now: () => updatedAt });

    await useCase.execute({
      listingId,
      patch: { notes: null, price: null, propertyType: null },
    });

    expect(repository.updatedListings[0]).toMatchObject({
      notes: null,
      listing: { price: null, propertyType: null },
    });
  });

  it("rejects empty and semantically invalid patches before persistence", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new UpdateManualListing({ repository, now: () => updatedAt });

    await expect(useCase.execute({ listingId, patch: {} })).rejects.toMatchObject({
      name: "InvalidManualListingPatchError",
    });
    await expect(
      useCase.execute({ listingId, patch: { latitude: 91 } }),
    ).rejects.toMatchObject({
      name: "InvalidManualListingError",
      field: "latitude",
    });
    expect(repository.updatedListings).toEqual([]);
  });

  it("uses one not-found outcome for invalid, missing, and stale IDs", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new UpdateManualListing({ repository, now: () => updatedAt });

    await expect(
      useCase.execute({ listingId: "not-a-uuid", patch: { city: "Corona" } }),
    ).rejects.toMatchObject({ name: "ManualListingNotFoundError" });

    repository.currentRecord = null;
    await expect(
      useCase.execute({ listingId, patch: { city: "Corona" } }),
    ).rejects.toMatchObject({ name: "ManualListingNotFoundError" });

    repository.currentRecord = createRecord();
    repository.updateResult = null;
    await expect(
      useCase.execute({ listingId, patch: { city: "Corona" } }),
    ).rejects.toMatchObject({ name: "ManualListingNotFoundError" });
  });
});

class RecordingManualListingRepository
  implements ManualListingMutationRepositoryPort
{
  currentRecord: ManualListingRecord | null = createRecord();
  updateResult: ManualListingRecord | null | undefined;
  updatedRecord: ManualListingRecord | undefined;
  readonly updatedListings: UpdateManualListingPersistenceInput[] = [];

  async findActiveManualListing(
    _id: string,
  ): Promise<ManualListingRecord | null> {
    return this.currentRecord;
  }

  async updateManualListing(
    input: UpdateManualListingPersistenceInput,
  ): Promise<ManualListingRecord | null> {
    this.updatedListings.push(input);
    if (this.updateResult === null) {
      return null;
    }
    this.updatedRecord = {
      ...createRecord(),
      listing: input.listing,
      notes: input.notes,
      updatedAt: input.updatedAt,
    };
    return this.updatedRecord;
  }

  async archiveManualListing(
    _input: ArchiveManualListingPersistenceInput,
  ): Promise<boolean> {
    throw new Error("Not used");
  }
}

function createRecord(): ManualListingRecord {
  return {
    id: listingId,
    listing: {
      source: "manual",
      sourceListingId: null,
      mlsName: null,
      mlsNumber: null,
      formattedAddress: "123 Main St, Eastvale, CA 92880",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Eastvale",
      state: "CA",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 2.5,
      price: 825000,
      status: "Active",
      listedDate: "2026-08-19",
      lastSeenDate: "2026-08-20",
      firstDiscoveredAt: "2026-08-20T19:30:00.000Z",
    },
    createdByUserId: actorUserId,
    notes: "Existing private note",
    archivedAt: null,
    createdAt: "2026-08-20T19:30:00.000Z",
    updatedAt: "2026-08-20T19:30:00.000Z",
  };
}
