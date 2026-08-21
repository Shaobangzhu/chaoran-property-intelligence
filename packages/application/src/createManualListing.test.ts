import { describe, expect, it } from "vitest";

import { CreateManualListing } from "./createManualListing.js";
import type {
  CreateManualListingPersistenceInput,
  ManualListingRecord,
  ManualListingRepositoryPort,
} from "./manualListingRepository.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const now = new Date("2026-08-20T19:30:00.000Z");

describe("CreateManualListing", () => {
  it("controls identity, ownership, source, and timestamps before persistence", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = createUseCase(repository);

    const record = await useCase.execute({
      actorUserId,
      draft: {
        addressLine1: "123 Main St",
        city: "Eastvale",
        state: "CA",
        zipCode: "92880",
        latitude: 33.9525,
        longitude: -117.5848,
        status: "Active",
        notes: "Client referral",
      },
    });

    expect(repository.createdListings).toEqual([
      {
        id: listingId,
        createdByUserId: actorUserId,
        listing: expect.objectContaining({
          source: "manual",
          sourceListingId: null,
          formattedAddress: "123 Main St, Eastvale, CA 92880",
          firstDiscoveredAt: "2026-08-20T19:30:00.000Z",
          lastSeenDate: "2026-08-20",
        }),
        notes: "Client referral",
        createdAt: "2026-08-20T19:30:00.000Z",
        updatedAt: "2026-08-20T19:30:00.000Z",
      },
    ]);
    expect(record).toEqual(repository.returnedRecord);
  });

  it("rejects an invalid actor before generating identity or persisting", async () => {
    const repository = new RecordingManualListingRepository();
    let idFactoryCalls = 0;
    const useCase = new CreateManualListing({
      repository,
      createId: () => {
        idFactoryCalls += 1;
        return listingId;
      },
      now: () => now,
    });

    await expect(
      useCase.execute({
        actorUserId: "not-a-uuid",
        draft: createDraft(),
      }),
    ).rejects.toMatchObject({
      name: "InvalidManualListingError",
      field: "actorUserId",
    });
    expect(idFactoryCalls).toBe(0);
    expect(repository.createdListings).toEqual([]);
  });

  it("rejects an invalid server-generated ID without persisting", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = new CreateManualListing({
      repository,
      createId: () => "not-a-uuid",
      now: () => now,
    });

    await expect(
      useCase.execute({ actorUserId, draft: createDraft() }),
    ).rejects.toThrow("Manual listing ID factory returned an invalid UUID");
    expect(repository.createdListings).toEqual([]);
  });

  it("does not persist a semantically invalid draft", async () => {
    const repository = new RecordingManualListingRepository();
    const useCase = createUseCase(repository);

    await expect(
      useCase.execute({
        actorUserId,
        draft: createDraft({ latitude: 91 }),
      }),
    ).rejects.toMatchObject({
      name: "InvalidManualListingError",
      field: "latitude",
    });
    expect(repository.createdListings).toEqual([]);
  });
});

class RecordingManualListingRepository
  implements ManualListingRepositoryPort
{
  readonly createdListings: CreateManualListingPersistenceInput[] = [];
  returnedRecord: ManualListingRecord | undefined;

  async createManualListing(
    input: CreateManualListingPersistenceInput,
  ): Promise<ManualListingRecord> {
    this.createdListings.push(input);
    this.returnedRecord = {
      ...input,
      archivedAt: null,
    };
    return this.returnedRecord;
  }
}

function createUseCase(
  repository: ManualListingRepositoryPort,
): CreateManualListing {
  return new CreateManualListing({
    repository,
    createId: () => listingId,
    now: () => now,
  });
}

function createDraft(
  overrides: Partial<{
    latitude: number;
  }> = {},
) {
  return {
    addressLine1: "123 Main St",
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9525,
    longitude: -117.5848,
    status: "Active",
    ...overrides,
  };
}
