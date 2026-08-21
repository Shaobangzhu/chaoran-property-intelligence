import { describe, expect, it } from "vitest";

import type {
  CreateManualListingPersistenceInput,
  UpdateManualListingPersistenceInput,
} from "@chaoran-property-intelligence/application";

import { PostgresManualListingRepository } from "./postgresManualListingRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";

describe("PostgresManualListingRepository", () => {
  it("creates a manual row with isolated deduplication and notification state", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createManualListingRow()] },
    ]);
    const repository = new PostgresManualListingRepository(database);

    const record = await repository.createManualListing(createInput());

    expect(database.queries[0]?.text).toContain("INSERT INTO listings");
    expect(database.queries[0]?.text).toContain("RETURNING");
    expect(database.queries[0]?.parameters).toEqual([
      listingId,
      `manual:${listingId}`,
      "manual",
      null,
      null,
      null,
      "123 Main St, Eastvale, CA 92880",
      "123 Main St",
      null,
      "Eastvale",
      "CA",
      "92880",
      33.9525,
      -117.5848,
      null,
      null,
      null,
      null,
      "Active",
      null,
      "2026-08-20",
      "2026-08-20T19:30:00.000Z",
      "not_applicable",
      actorUserId,
      "Client referral",
      null,
      "2026-08-20T19:30:00.000Z",
      "2026-08-20T19:30:00.000Z",
    ]);
    expect(record).toEqual({
      ...createInput(),
      archivedAt: null,
    });
  });

  it("rejects a malformed returned manual row", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [createManualListingRow({ created_by_user_id: null })],
      },
    ]);
    const repository = new PostgresManualListingRepository(database);

    await expect(
      repository.createManualListing(createInput()),
    ).rejects.toThrow(
      "PostgreSQL manual listing row did not match the expected schema",
    );
  });

  it("loads only an active manual record", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createManualListingRow()] },
    ]);
    const repository = new PostgresManualListingRepository(database);

    await expect(repository.findActiveManualListing(listingId)).resolves.toEqual({
      ...createInput(),
      archivedAt: null,
    });
    expect(database.queries[0]?.text).toContain(
      "source = 'manual' AND archived_at IS NULL",
    );
    expect(database.queries[0]?.parameters).toEqual([listingId]);
  });

  it("updates only editable manual columns and preserves record metadata", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createManualListingRow({ city: "Corona", notes: null })] },
    ]);
    const repository = new PostgresManualListingRepository(database);
    const input: UpdateManualListingPersistenceInput = {
      id: listingId,
      listing: {
        ...createInput().listing,
        city: "Corona",
        formattedAddress: "123 Main St, Corona, CA 92880",
      },
      notes: null,
      updatedAt: "2026-08-21T01:30:00.000Z",
    };

    await expect(repository.updateManualListing(input)).resolves.toMatchObject({
      id: listingId,
      notes: null,
      listing: { city: "Corona" },
    });
    expect(database.queries[0]?.text).toContain("UPDATE listings");
    expect(database.queries[0]?.text).toContain(
      "source = 'manual' AND archived_at IS NULL",
    );
    expect(database.queries[0]?.text).not.toContain("created_by_user_id =");
    expect(database.queries[0]?.parameters).toEqual([
      listingId,
      null,
      null,
      "123 Main St, Corona, CA 92880",
      "123 Main St",
      null,
      "Corona",
      "CA",
      "92880",
      33.9525,
      -117.5848,
      null,
      null,
      null,
      null,
      "Active",
      null,
      null,
      "2026-08-21T01:30:00.000Z",
    ]);
  });

  it("archives an active manual record without deleting it", async () => {
    const database = new RecordingSqlDatabase([{ rows: [{ id: listingId }] }]);
    const repository = new PostgresManualListingRepository(database);

    await expect(
      repository.archiveManualListing({
        id: listingId,
        archivedAt: "2026-08-21T02:00:00.000Z",
        updatedAt: "2026-08-21T02:00:00.000Z",
      }),
    ).resolves.toBe(true);
    expect(database.queries[0]?.text).toContain("SET archived_at = $2");
    expect(database.queries[0]?.text).not.toContain("DELETE");
    expect(database.queries[0]?.parameters).toEqual([
      listingId,
      "2026-08-21T02:00:00.000Z",
      "2026-08-21T02:00:00.000Z",
    ]);
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];

  constructor(private readonly responses: SqlQueryResult[] = []) {}

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
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createInput(): CreateManualListingPersistenceInput {
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
      propertyType: null,
      bedrooms: null,
      bathrooms: null,
      price: null,
      status: "Active",
      listedDate: null,
      lastSeenDate: "2026-08-20",
      firstDiscoveredAt: "2026-08-20T19:30:00.000Z",
    },
    createdByUserId: actorUserId,
    notes: "Client referral",
    createdAt: "2026-08-20T19:30:00.000Z",
    updatedAt: "2026-08-20T19:30:00.000Z",
  };
}

function createManualListingRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: listingId,
    source: "manual",
    source_listing_id: null,
    mls_name: null,
    mls_number: null,
    formatted_address: "123 Main St, Eastvale, CA 92880",
    address_line_1: "123 Main St",
    address_line_2: null,
    city: "Eastvale",
    state: "CA",
    zip_code: "92880",
    latitude: 33.9525,
    longitude: -117.5848,
    property_type: null,
    bedrooms: null,
    bathrooms: null,
    price: null,
    status: "Active",
    listed_date: null,
    last_seen_date: "2026-08-20",
    first_discovered_at: "2026-08-20T19:30:00.000Z",
    created_by_user_id: actorUserId,
    notes: "Client referral",
    archived_at: null,
    created_at: new Date("2026-08-20T19:30:00.000Z"),
    updated_at: new Date("2026-08-20T19:30:00.000Z"),
    ...overrides,
  };
}
