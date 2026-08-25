import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
} from "@chaoran-property-intelligence/domain";

import { FakeListingSearchProfileRepository } from "./fakeListingSearchProfile.js";
import type {
  ListingSearchProfile,
  ListingSearchProfileRepositoryPort,
} from "./listingSearchProfile.js";
import {
  GetListingSearchCriteria,
  InvalidListingSearchCriteriaInputError,
  InvalidListingSearchCriteriaResultError,
  ListingSearchCriteriaChangedError,
  ListingSearchProfileUnavailableError,
  UpdateListingSearchCriteria,
  type UpdateListingSearchCriteriaInput,
} from "./listingSearchCriteriaUseCases.js";

describe("listing search criteria use cases", () => {
  it("gets a bounded editable view without persistence metadata", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });

    const result = await new GetListingSearchCriteria(repository).execute();

    expect(result).toEqual({
      criteria: editableDefaultCriteria(),
      revision: 1,
      updatedAt: initialUpdatedAt,
    });
    expect(result).not.toHaveProperty("appliedRevision");
    expect(result).not.toHaveProperty("updatedByUserId");
    expect(result.criteria).not.toHaveProperty("state");
    expect(result.criteria).not.toHaveProperty("status");
    expect(result.criteria).not.toHaveProperty("schemaVersion");
  });

  it("fails closed when the seeded primary profile is unavailable", async () => {
    const repository = new FakeListingSearchProfileRepository({ profile: null });

    await expect(
      new GetListingSearchCriteria(repository).execute(),
    ).rejects.toThrow(ListingSearchProfileUnavailableError);
  });

  it("fails closed when a query adapter returns malformed profile data", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });
    repository.returnUnsafeProfileOnFind({
      ...createProfile(),
      revision: 0,
    });

    await expect(
      new GetListingSearchCriteria(repository).execute(),
    ).rejects.toThrow(InvalidListingSearchCriteriaResultError);
  });

  it("injects fixed criteria, attributes the actor, and returns a changed revision", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });
    const useCase = createUpdateUseCase(repository);
    const input = createUpdateInput({
      criteria: {
        propertyType: "Condo",
        minimumPrice: 600000,
        maximumPrice: 900000,
        minimumBedrooms: 2,
        minimumBathrooms: 1.5,
        cities: ["Corona", "Chino"],
      },
    });

    const result = await useCase.execute(input);

    expect(repository.calls).toEqual([
      {
        method: "savePrimaryProfile",
        input: {
          criteria: normalizeListingSearchCriteria({
            schemaVersion: 1,
            state: "CA",
            status: "Active",
            ...input.criteria,
          }),
          expectedRevision: 1,
          updatedByUserId: actorUserId,
          updatedAt,
        },
      },
    ]);
    expect(result).toEqual({
      criteria: {
        ...input.criteria,
        cities: ["Chino", "Corona"],
      },
      revision: 2,
      updatedAt,
    });
    expect(repository.currentProfile).toMatchObject({
      appliedRevision: 1,
      revision: 2,
      updatedByUserId: actorUserId,
      updatedAt,
    });
  });

  it("opts a legacy profile into Stevenson Ranch with one revision change", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile({
        criteria: normalizeListingSearchCriteria({
          ...defaultListingSearchCriteria,
          cities: [
            "Chino",
            "Chino Hills",
            "Eastvale",
            "Corona",
            "Jurupa Valley",
          ],
        }),
      }),
    });
    const criteria = {
      ...editableDefaultCriteria(),
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
      ] as const,
    };

    const result = await createUpdateUseCase(repository).execute(
      createUpdateInput({ criteria }),
    );

    expect(result).toEqual({ criteria, revision: 2, updatedAt });
    expect(repository.calls).toHaveLength(1);
    expect(repository.currentProfile).toMatchObject({
      appliedRevision: 1,
      criteria: {
        ...defaultListingSearchCriteria,
        cities: criteria.cities,
      },
      revision: 2,
      updatedByUserId: actorUserId,
    });
  });

  it("returns a canonical no-op without changing revision or audit metadata", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });
    const useCase = createUpdateUseCase(repository);

    const result = await useCase.execute(
      createUpdateInput({
        criteria: {
          ...editableDefaultCriteria(),
          cities: [...defaultListingSearchCriteria.cities].reverse(),
        },
      }),
    );

    expect(result).toEqual({
      criteria: editableDefaultCriteria(),
      revision: 1,
      updatedAt: initialUpdatedAt,
    });
    expect(repository.currentProfile).toEqual(createProfile());
  });

  it("maps stale revisions and a lost save race to one changed error", async () => {
    const staleRepository = new FakeListingSearchProfileRepository({
      profile: createProfile({ revision: 2 }),
    });
    await expect(
      createUpdateUseCase(staleRepository).execute(createUpdateInput()),
    ).rejects.toThrow(ListingSearchCriteriaChangedError);

    const racingRepository = new FakeListingSearchProfileRepository({
      conflictOnNextSave: true,
      profile: createProfile(),
    });
    await expect(
      createUpdateUseCase(racingRepository).execute(createUpdateInput()),
    ).rejects.toThrow(ListingSearchCriteriaChangedError);
  });

  it.each([
    { ...createUpdateInput(), extra: true },
    { ...createUpdateInput(), actorUserId: "not-a-uuid" },
    { ...createUpdateInput(), expectedRevision: 0 },
    {
      ...createUpdateInput(),
      criteria: { ...editableDefaultCriteria(), state: "AZ" },
    },
    {
      ...createUpdateInput(),
      criteria: { ...editableDefaultCriteria(), schemaVersion: 1 },
    },
    {
      ...createUpdateInput(),
      criteria: { ...editableDefaultCriteria(), propertyType: "Duplex" },
    },
    {
      ...createUpdateInput(),
      criteria: { ...editableDefaultCriteria(), cities: [] },
    },
    {
      ...createUpdateInput(),
      criteria: {
        ...editableDefaultCriteria(),
        minimumPrice: 900001,
        maximumPrice: 900000,
      },
    },
  ])("rejects strict invalid input before persistence: %o", async (input) => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });

    await expect(
      createUpdateUseCase(repository).execute(input as never),
    ).rejects.toThrow(InvalidListingSearchCriteriaInputError);
    expect(repository.calls).toEqual([]);
  });

  it("rejects an invalid clock before persistence", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });
    const useCase = new UpdateListingSearchCriteria({
      now: () => new Date(Number.NaN),
      repository,
    });

    await expect(useCase.execute(createUpdateInput())).rejects.toThrow(
      "Listing search criteria clock was invalid",
    );
    expect(repository.calls).toEqual([]);
  });

  it("does not hide repository failures", async () => {
    const failure = new Error("database unavailable");
    const repository = new FakeListingSearchProfileRepository({
      failures: { savePrimaryProfile: failure },
      profile: createProfile(),
    });

    await expect(
      createUpdateUseCase(repository).execute(createUpdateInput()),
    ).rejects.toBe(failure);
  });

  it.each([
    { label: "revision", override: { revision: 4 } },
    {
      label: "criteria",
      override: { criteria: defaultListingSearchCriteria },
    },
    {
      label: "actor",
      override: {
        updatedByUserId: "0198c7d2-7668-7775-b0fc-b789690a60c2",
      },
    },
    {
      label: "timestamp",
      override: { updatedAt: "2026-08-22T19:01:00.000Z" },
    },
    { label: "applied revision", override: { appliedRevision: 2 } },
  ])("rejects an inconsistent updated $label result", async ({ override }) => {
    const repository: ListingSearchProfileRepositoryPort = {
      async findPrimaryProfile() {
        return createProfile();
      },
      async savePrimaryProfile() {
        return {
          status: "updated",
          profile: createProfile({
            criteria: normalizeListingSearchCriteria({
              ...defaultListingSearchCriteria,
              propertyType: "Condo",
            }),
            revision: 2,
            updatedByUserId: actorUserId,
            updatedAt,
            ...override,
          }),
        };
      },
    };

    await expect(
      createUpdateUseCase(repository).execute(createUpdateInput()),
    ).rejects.toThrow(InvalidListingSearchCriteriaResultError);
  });
});

const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const createdAt = "2026-08-20T19:00:00.000Z";
const initialUpdatedAt = "2026-08-21T19:00:00.000Z";
const updatedAt = "2026-08-22T19:00:00.000Z";

function createUpdateUseCase(repository: ListingSearchProfileRepositoryPort) {
  return new UpdateListingSearchCriteria({
    now: () => new Date(updatedAt),
    repository,
  });
}

function createUpdateInput(
  overrides: Partial<UpdateListingSearchCriteriaInput> = {},
): UpdateListingSearchCriteriaInput {
  return {
    actorUserId,
    criteria: {
      ...editableDefaultCriteria(),
      propertyType: "Condo",
    },
    expectedRevision: 1,
    ...overrides,
  };
}

function editableDefaultCriteria() {
  return {
    propertyType: defaultListingSearchCriteria.propertyType,
    minimumPrice: defaultListingSearchCriteria.minimumPrice,
    maximumPrice: defaultListingSearchCriteria.maximumPrice,
    minimumBedrooms: defaultListingSearchCriteria.minimumBedrooms,
    minimumBathrooms: defaultListingSearchCriteria.minimumBathrooms,
    cities: [...defaultListingSearchCriteria.cities],
  };
}

function createProfile(
  overrides: Partial<ListingSearchProfile> = {},
): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: defaultListingSearchCriteria,
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt,
    updatedAt: initialUpdatedAt,
    ...overrides,
  };
}
