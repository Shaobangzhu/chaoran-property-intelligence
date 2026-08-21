import type {
  ListingQueryPort,
  ListingRecord,
  ShowingListListingQueryPort,
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

export class PostgresListingQuery
  implements ListingQueryPort, ShowingListListingQueryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async listListings(): Promise<ListingRecord[]> {
    const result = await this.database.query(
      `SELECT ${listingQueryColumns}
       FROM listings
       WHERE archived_at IS NULL
       ORDER BY listed_date DESC NULLS LAST, id ASC`,
    );

    return mapListingRecords(result);
  }

  async findActiveListingsByIds(
    listingIds: readonly string[],
  ): Promise<ListingRecord[]> {
    if (listingIds.length === 0) {
      return [];
    }

    const result = await this.database.query(
      `SELECT ${listingQueryColumns}
       FROM listings
       WHERE archived_at IS NULL
         AND id = ANY($1::uuid[])
       ORDER BY id ASC`,
      [listingIds],
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
