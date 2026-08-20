import { describe, expect, it } from "vitest";

import type { NormalizedListing } from "@chaoran-property-intelligence/domain";

import { PostgresListingRepository } from "./postgresListingRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingRepository", () => {
  it("initializes an empty baseline marker inside a transaction", async () => {
    const database = new RecordingSqlDatabase();
    const repository = new PostgresListingRepository(database);

    await repository.initializeBaseline([]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.text).toContain(
      "INSERT INTO alert_worker_state",
    );
  });

  it("stores baseline listings and the marker in the same transaction", async () => {
    const database = new RecordingSqlDatabase();
    const repository = new PostgresListingRepository(database);
    const listing = createListing();

    await repository.initializeBaseline([
      {
        deduplicationKey: "mls:CRMLS:IG26000001:2026-08-19",
        listing,
        notificationStatus: "baseline",
      },
    ]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries).toHaveLength(2);
    expect(database.queries[0]?.text).toContain("INSERT INTO listings");
    expect(database.queries[0]?.parameters).toContain(33.9525);
    expect(database.queries[0]?.parameters).toContain(-117.5848);
    expect(database.queries[0]?.parameters).toContain("baseline");
    expect(database.queries[1]?.text).toContain(
      "INSERT INTO alert_worker_state",
    );
  });

  it("maps pending database rows back to stored listings", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [createListingRow()],
      },
    ]);
    const repository = new PostgresListingRepository(database);

    const records = await repository.findPendingListings();

    expect(records).toEqual([
      {
        deduplicationKey: "rentcast:rentcast-new:2026-08-19",
        listing: createListing({
          sourceListingId: "rentcast-new",
          mlsName: null,
          mlsNumber: null,
          formattedAddress: "456 Oak Ave, Chino, CA 91710",
          addressLine1: "456 Oak Ave",
          city: "Chino",
          zipCode: "91710",
          latitude: 34.0122,
          longitude: -117.6889,
        }),
        notificationStatus: "pending",
      },
    ]);
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  transactionCount = 0;

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
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createListing(
  overrides: Partial<NormalizedListing> = {},
): NormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "rentcast-baseline",
    mlsName: "CRMLS",
    mlsNumber: "IG26000001",
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
    lastSeenDate: "2026-08-19",
    firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
    ...overrides,
  };
}

function createListingRow(): Record<string, unknown> {
  return {
    deduplication_key: "rentcast:rentcast-new:2026-08-19",
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
    notification_status: "pending",
  };
}
