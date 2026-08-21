import {
  ArchiveManualListing,
  CreateManualListing,
  ListListings,
  UpdateManualListing,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import { PostgresListingQuery } from "./postgresListingQuery.js";
import { PostgresManualListingRepository } from "./postgresManualListingRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60d2";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";

describe("manual listing PostgreSQL lifecycle integration", () => {
  it("creates, reads, edits, and soft-archives one manual listing", async () => {
    const database = new StatefulListingDatabase();
    const repository = new PostgresManualListingRepository(database);
    const timestamps = [
      new Date("2026-08-20T19:30:00.000Z"),
      new Date("2026-08-20T20:00:00.000Z"),
      new Date("2026-08-20T20:30:00.000Z"),
    ];
    const now = (): Date => {
      const value = timestamps.shift();
      if (value === undefined) throw new Error("Unexpected clock read");
      return value;
    };
    const create = new CreateManualListing({
      createId: () => listingId,
      now,
      repository,
    });
    const update = new UpdateManualListing({ now, repository });
    const archive = new ArchiveManualListing({ now, repository });
    const list = new ListListings({
      query: new PostgresListingQuery(database),
    });

    const created = await create.execute({
      actorUserId,
      draft: {
        addressLine1: " 456 Client Way ",
        city: "Corona",
        state: "CA",
        zipCode: "92879",
        latitude: 33.8753,
        longitude: -117.5664,
        price: 735000,
        status: "Active",
        notes: "Client supplied listing",
      },
    });

    expect(created).toMatchObject({
      createdByUserId: actorUserId,
      id: listingId,
      listing: {
        addressLine1: "456 Client Way",
        source: "manual",
      },
      notes: "Client supplied listing",
    });
    await expect(list.execute()).resolves.toEqual([
      { id: listingId, listing: created.listing },
    ]);

    const updated = await update.execute({
      listingId,
      patch: { city: "Norco", price: null },
    });

    expect(updated).toMatchObject({
      createdByUserId: actorUserId,
      notes: "Client supplied listing",
      listing: {
        city: "Norco",
        formattedAddress: "456 Client Way, Norco, CA 92879",
        price: null,
        source: "manual",
      },
      updatedAt: "2026-08-20T20:00:00.000Z",
    });
    expect(updated.createdAt).toBe("2026-08-20T19:30:00.000Z");

    await archive.execute({ listingId });

    await expect(list.execute()).resolves.toEqual([]);
    await expect(repository.findActiveManualListing(listingId)).resolves.toBeNull();
    expect(database.row).toMatchObject({
      archived_at: new Date("2026-08-20T20:30:00.000Z"),
      created_by_user_id: actorUserId,
      source: "manual",
      updated_at: new Date("2026-08-20T20:30:00.000Z"),
    });
    expect(database.queries.some((query) => /DELETE\s+FROM/iu.test(query))).toBe(
      false,
    );
  });
});

class StatefulListingDatabase implements SqlDatabase {
  row: Record<string, unknown> | null = null;
  readonly queries: string[] = [];

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push(text);
    if (text.includes("INSERT INTO listings")) {
      this.row = rowFromInsert(parameters);
      return { rows: [this.row] };
    }
    if (text.includes("SET archived_at")) {
      if (!this.isActiveManual(parameters[0])) return { rows: [] };
      this.row = {
        ...this.row,
        archived_at: new Date(readString(parameters[1])),
        updated_at: new Date(readString(parameters[2])),
      };
      return { rows: [{ id: this.row.id }] };
    }
    if (text.includes("UPDATE listings")) {
      if (!this.isActiveManual(parameters[0])) return { rows: [] };
      this.row = rowFromUpdate(this.row, parameters);
      return { rows: [this.row] };
    }
    if (text.includes("WHERE id = $1")) {
      return {
        rows: this.isActiveManual(parameters[0]) ? [this.row] : [],
      };
    }
    if (text.includes("FROM listings")) {
      expect(text).toContain("WHERE archived_at IS NULL");
      return {
        rows: this.row?.archived_at === null ? [this.row] : [],
      };
    }
    throw new Error("Unexpected SQL in lifecycle integration test");
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {}

  private isActiveManual(id: unknown): boolean {
    return (
      this.row !== null &&
      this.row.id === id &&
      this.row.source === "manual" &&
      this.row.archived_at === null
    );
  }
}

function rowFromInsert(parameters: readonly unknown[]): Record<string, unknown> {
  return {
    id: parameters[0],
    source: parameters[2],
    source_listing_id: parameters[3],
    mls_name: parameters[4],
    mls_number: parameters[5],
    formatted_address: parameters[6],
    address_line_1: parameters[7],
    address_line_2: parameters[8],
    city: parameters[9],
    state: parameters[10],
    zip_code: parameters[11],
    latitude: parameters[12],
    longitude: parameters[13],
    property_type: parameters[14],
    bedrooms: parameters[15],
    bathrooms: parameters[16],
    price: parameters[17],
    status: parameters[18],
    listed_date: parameters[19],
    last_seen_date: parameters[20],
    first_discovered_at: parameters[21],
    created_by_user_id: parameters[23],
    notes: parameters[24],
    archived_at: parameters[25],
    created_at: new Date(readString(parameters[26])),
    updated_at: new Date(readString(parameters[27])),
  };
}

function rowFromUpdate(
  current: Record<string, unknown> | null,
  parameters: readonly unknown[],
): Record<string, unknown> {
  if (current === null) throw new Error("Expected a current row");
  return {
    ...current,
    mls_name: parameters[1],
    mls_number: parameters[2],
    formatted_address: parameters[3],
    address_line_1: parameters[4],
    address_line_2: parameters[5],
    city: parameters[6],
    state: parameters[7],
    zip_code: parameters[8],
    latitude: parameters[9],
    longitude: parameters[10],
    property_type: parameters[11],
    bedrooms: parameters[12],
    bathrooms: parameters[13],
    price: parameters[14],
    status: parameters[15],
    listed_date: parameters[16],
    notes: parameters[17],
    updated_at: new Date(readString(parameters[18])),
  };
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a timestamp");
  return value;
}
