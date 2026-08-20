import type {
  ListingQueryPort,
  ListingRecord,
} from "@chaoran-property-intelligence/application";

import {
  normalizedListingColumns,
  parseNormalizedListing,
  readRecord,
  readString,
} from "./listingRow.js";
import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

const listingQueryColumns = `
  id,
  ${normalizedListingColumns}
`;

export class PostgresListingQuery implements ListingQueryPort {
  constructor(private readonly database: SqlDatabase) {}

  async listListings(): Promise<ListingRecord[]> {
    const result = await this.database.query(
      `SELECT ${listingQueryColumns}
       FROM listings
       ORDER BY listed_date DESC, id ASC`,
    );

    return mapListingRecords(result);
  }
}

function mapListingRecords(result: SqlQueryResult): ListingRecord[] {
  return result.rows.map((value) => {
    const row = readRecord(value);

    return {
      id: readString(row, "id"),
      listing: parseNormalizedListing(row),
    };
  });
}
