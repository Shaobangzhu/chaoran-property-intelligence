import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
} from "@chaoran-property-intelligence/domain";

import { FakeListingSearchProfileRepository } from "./fakeListingSearchProfile.js";
import type { ListingSearchProfile } from "./listingSearchProfile.js";

describe("FakeListingSearchProfileRepository", () => {
  it("returns immutable defensive profile values and records reads", async () => {
    const source = createProfile();
    const repository = new FakeListingSearchProfileRepository({
      profile: source,
    });

    const found = await repository.findPrimaryProfile();

    expect(found).toEqual(source);
    expect(found).not.toBe(source);
    expect(Object.isFrozen(found)).toBe(true);
    expect(repository.calls).toEqual([{ method: "findPrimaryProfile" }]);
  });

  it("implements changed, canonical no-op, and stale conflict behavior", async () => {
    const repository = new FakeListingSearchProfileRepository({
      profile: createProfile(),
    });
    const changedCriteria = normalizeListingSearchCriteria({
      ...defaultListingSearchCriteria,
      propertyType: "Condo",
      cities: ["Corona", "Chino"],
    });

    await expect(
      repository.savePrimaryProfile({
        criteria: changedCriteria,
        expectedRevision: 1,
        updatedByUserId: actorUserId,
        updatedAt,
      }),
    ).resolves.toMatchObject({ status: "updated" });
    expect(repository.currentProfile).toMatchObject({
      appliedRevision: 1,
      criteria: changedCriteria,
      revision: 2,
    });

    await expect(
      repository.savePrimaryProfile({
        criteria: {
          ...changedCriteria,
          cities: [...changedCriteria.cities].reverse(),
        },
        expectedRevision: 2,
        updatedByUserId: actorUserId,
        updatedAt: "2026-08-22T19:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "unchanged" });
    expect(repository.currentProfile?.revision).toBe(2);

    await expect(
      repository.savePrimaryProfile({
        criteria: defaultListingSearchCriteria,
        expectedRevision: 1,
        updatedByUserId: actorUserId,
        updatedAt: "2026-08-22T19:02:00.000Z",
      }),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("can deterministically simulate a lost update race", async () => {
    const repository = new FakeListingSearchProfileRepository({
      conflictOnNextSave: true,
      profile: createProfile(),
    });

    await expect(
      repository.savePrimaryProfile({
        criteria: normalizeListingSearchCriteria({
          ...defaultListingSearchCriteria,
          propertyType: "Condo",
        }),
        expectedRevision: 1,
        updatedByUserId: actorUserId,
        updatedAt,
      }),
    ).resolves.toEqual({ status: "conflict" });
    expect(repository.currentProfile).toEqual(createProfile());
  });

  it("propagates configured method failures", async () => {
    const failure = new Error("query failed");
    const repository = new FakeListingSearchProfileRepository({
      failures: { findPrimaryProfile: failure },
      profile: createProfile(),
    });

    await expect(repository.findPrimaryProfile()).rejects.toBe(failure);
  });
});

const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const updatedAt = "2026-08-22T19:00:00.000Z";

function createProfile(): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: defaultListingSearchCriteria,
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-21T19:00:00.000Z",
  };
}
