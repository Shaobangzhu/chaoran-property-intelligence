import { describe, expect, it } from "vitest";

import type {
  SaveListingSearchProfileInput,
} from "@chaoran-property-intelligence/application";
import {
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import { PostgresListingSearchProfileRepository } from "./postgresListingSearchProfileRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingSearchProfileRepository", () => {
  it("reads and strictly parses the primary profile", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createProfileRow()] },
    ]);
    const repository = new PostgresListingSearchProfileRepository(database);

    const profile = await repository.findPrimaryProfile();

    expect(database.queries[0]?.text).toContain(
      "FROM listing_search_profiles",
    );
    expect(database.queries[0]?.text).not.toContain("FOR UPDATE");
    expect(database.queries[0]?.parameters).toEqual(["primary"]);
    expect(profile).toEqual(createExpectedProfile());
  });

  it("returns null when the primary profile is absent", async () => {
    const database = new RecordingSqlDatabase([{ rows: [] }]);
    const repository = new PostgresListingSearchProfileRepository(database);

    await expect(repository.findPrimaryProfile()).resolves.toBeNull();
  });

  it("locks and updates a changed profile without applying its revision", async () => {
    const criteria = createChangedCriteria();
    const database = new RecordingSqlDatabase([
      { rows: [createProfileRow()] },
      {
        rows: [
          createProfileRow({
            criteria,
            revision: "2",
            updated_by_user_id: actorUserId,
            updated_at: new Date(updatedAt),
          }),
        ],
      },
    ]);
    const repository = new PostgresListingSearchProfileRepository(database);

    const result = await repository.savePrimaryProfile(
      createSaveInput(criteria),
    );

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.text).toContain("FOR UPDATE");
    expect(database.queries[1]?.text).toContain(
      "revision = revision + 1",
    );
    expect(database.queries[1]?.text).not.toContain(
      "applied_revision =",
    );
    expect(database.queries[1]?.parameters).toEqual([
      "primary",
      1,
      JSON.stringify(criteria),
      actorUserId,
      updatedAt,
      1,
    ]);
    expect(result).toEqual({
      status: "updated",
      profile: createExpectedProfile({
        criteria,
        revision: 2,
        updatedByUserId: actorUserId,
        updatedAt,
      }),
    });
    expect(result.status === "updated" && result.profile.appliedRevision).toBe(
      1,
    );
  });

  it("returns unchanged for canonically equal criteria without incrementing revision", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createProfileRow()] },
    ]);
    const repository = new PostgresListingSearchProfileRepository(database);
    const reorderedCriteria = {
      ...defaultListingSearchCriteria,
      cities: [...defaultListingSearchCriteria.cities].reverse(),
    } as ListingSearchCriteriaV1;

    const result = await repository.savePrimaryProfile(
      createSaveInput(reorderedCriteria),
    );

    expect(database.transactionCount).toBe(1);
    expect(database.queries).toHaveLength(1);
    expect(result).toEqual({
      status: "unchanged",
      profile: createExpectedProfile(),
    });
  });

  it("returns conflict for a stale revision without issuing an update", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createProfileRow({ revision: "2" })] },
    ]);
    const repository = new PostgresListingSearchProfileRepository(database);

    const result = await repository.savePrimaryProfile(
      createSaveInput(createChangedCriteria()),
    );

    expect(database.queries).toHaveLength(1);
    expect(result).toEqual({ status: "conflict" });
  });

  it("fails closed when the seeded primary profile is missing during save", async () => {
    const database = new RecordingSqlDatabase([{ rows: [] }]);
    const repository = new PostgresListingSearchProfileRepository(database);

    await expect(
      repository.savePrimaryProfile(createSaveInput(createChangedCriteria())),
    ).rejects.toThrow("PostgreSQL listing search profile was missing");
  });

  it.each([
    { profile_key: "secondary" },
    { schema_version: 2 },
    { criteria: { ...defaultListingSearchCriteria, state: "AZ" } },
    { revision: "0" },
    { revision: "9007199254740992" },
    { applied_revision: "2" },
    { updated_by_user_id: "not-a-uuid" },
    { created_at: "not-a-date" },
    { updated_at: new Date("2026-08-19T00:00:00.000Z") },
  ])("rejects a malformed profile row: %o", async (override) => {
    const database = new RecordingSqlDatabase([
      { rows: [createProfileRow(override)] },
    ]);
    const repository = new PostgresListingSearchProfileRepository(database);

    await expect(repository.findPrimaryProfile()).rejects.toThrow(
      "PostgreSQL listing search profile row did not match the expected schema",
    );
  });

  it.each([
    { expectedRevision: 0 },
    { updatedByUserId: "not-a-uuid" },
    { updatedAt: "August 22, 2026" },
    {
      criteria: {
        ...defaultListingSearchCriteria,
        propertyType: "Duplex",
      },
    },
  ])(
    "rejects invalid persistence input before opening a transaction: %o",
    async (override) => {
      const database = new RecordingSqlDatabase([]);
      const repository = new PostgresListingSearchProfileRepository(database);
      const input = {
        ...createSaveInput(createChangedCriteria()),
        ...override,
      } as SaveListingSearchProfileInput;

      await expect(repository.savePrimaryProfile(input)).rejects.toThrow(
        "Listing search profile persistence input was invalid",
      );
      expect(database.transactionCount).toBe(0);
      expect(database.queries).toHaveLength(0);
    },
  );
});

const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const createdAt = "2026-08-20T19:00:00.000Z";
const initialUpdatedAt = "2026-08-21T19:00:00.000Z";
const updatedAt = "2026-08-22T19:00:00.000Z";

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  transactionCount = 0;

  constructor(private readonly responses: SqlQueryResult[]) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createChangedCriteria(): ListingSearchCriteriaV1 {
  return normalizeListingSearchCriteria({
    ...defaultListingSearchCriteria,
    propertyType: "Condo",
    maximumPrice: 900000,
    minimumBedrooms: 2,
    minimumBathrooms: 1.5,
    cities: ["Corona", "Chino"],
  });
}

function createSaveInput(
  criteria: ListingSearchCriteriaV1,
): SaveListingSearchProfileInput {
  return {
    expectedRevision: 1,
    criteria,
    updatedByUserId: actorUserId,
    updatedAt,
  };
}

function createExpectedProfile(
  overrides: Record<string, unknown> = {},
) {
  return {
    profileKey: "primary" as const,
    schemaVersion: 1 as const,
    criteria: defaultListingSearchCriteria,
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt,
    updatedAt: initialUpdatedAt,
    ...overrides,
  };
}

function createProfileRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    profile_key: "primary",
    schema_version: 1,
    criteria: defaultListingSearchCriteria,
    revision: "1",
    applied_revision: "1",
    updated_by_user_id: null,
    created_at: new Date(createdAt),
    updated_at: new Date(initialUpdatedAt),
    ...overrides,
  };
}
