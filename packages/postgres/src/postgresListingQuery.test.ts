import { describe, expect, it } from "vitest";

import { PostgresListingQuery } from "./postgresListingQuery.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingQuery", () => {
  it("returns normalized records in deterministic listing order", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [createListingRow()],
      },
    ]);
    const query = new PostgresListingQuery(database);

    const records = await query.listListings();

    expect(records).toEqual([
      {
        id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
        listing: {
          source: "rentcast",
          sourceListingId: "rentcast-new",
          mlsName: null,
          mlsNumber: null,
          formattedAddress: "456 Oak Ave, Chino, CA 91710",
          addressLine1: "456 Oak Ave",
          addressLine2: null,
          city: "Chino",
          state: "CA",
          zipCode: "91710",
          latitude: 34.0122,
          longitude: -117.6889,
          propertyType: "Single Family",
          bedrooms: 4,
          bathrooms: 2.5,
          price: 825000,
          status: "Active",
          listedDate: "2026-08-19",
          lastSeenDate: "2026-08-19",
          firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
        },
      },
    ]);
    expect(database.queries[0]?.text).toContain(
      "ORDER BY listed_date DESC, id ASC",
    );
  });

  it("rejects rows without a string listing id", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [createListingRow({ id: null })],
      },
    ]);
    const query = new PostgresListingQuery(database);

    await expect(query.listListings()).rejects.toThrow(
      "PostgreSQL listing row did not match the expected schema",
    );
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

function createListingRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    source: "rentcast",
    source_listing_id: "rentcast-new",
    mls_name: null,
    mls_number: null,
    formatted_address: "456 Oak Ave, Chino, CA 91710",
    address_line_1: "456 Oak Ave",
    address_line_2: null,
    city: "Chino",
    state: "CA",
    zip_code: "91710",
    latitude: 34.0122,
    longitude: -117.6889,
    property_type: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825000,
    status: "Active",
    listed_date: "2026-08-19",
    last_seen_date: "2026-08-19",
    first_discovered_at: "2026-08-19T17:00:00.000Z",
    ...overrides,
  };
}
