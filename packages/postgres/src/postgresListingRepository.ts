import type {
  ListingRepositoryPort,
  StoredListing,
} from "@chaoran-property-intelligence/application";

import {
  normalizedListingColumns,
  parseNormalizedListing,
  readRecord,
  readString,
  throwInvalidListingRowError,
} from "./listingRow.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const baselineStateKey = "baseline_initialized";

const listingColumns = `
  deduplication_key,
  ${normalizedListingColumns},
  notification_status
`;

const insertListingSql = `
  INSERT INTO listings (${listingColumns})
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
  )
  ON CONFLICT (deduplication_key) DO NOTHING
`;

export class PostgresListingRepository implements ListingRepositoryPort {
  constructor(private readonly database: SqlDatabase) {}

  async isBaselineInitialized(): Promise<boolean> {
    const result = await this.database.query(
      `SELECT state_key
       FROM alert_worker_state
       WHERE state_key = $1
       LIMIT 1`,
      [baselineStateKey],
    );

    return result.rows.length > 0;
  }

  async initializeBaseline(listings: StoredListing[]): Promise<void> {
    await this.database.transaction(async (connection) => {
      for (const listing of listings) {
        await insertListing(connection, listing);
      }

      await connection.query(
        `INSERT INTO alert_worker_state (state_key)
         VALUES ($1)
         ON CONFLICT (state_key) DO NOTHING`,
        [baselineStateKey],
      );
    });
  }

  async findByDeduplicationKeys(
    deduplicationKeys: string[],
  ): Promise<StoredListing[]> {
    if (deduplicationKeys.length === 0) {
      return [];
    }

    const result = await this.database.query(
      `SELECT ${listingColumns}
       FROM listings
       WHERE deduplication_key = ANY($1::text[])`,
      [deduplicationKeys],
    );

    return mapStoredListings(result);
  }

  async savePendingListings(listings: StoredListing[]): Promise<void> {
    if (listings.length === 0) {
      return;
    }

    await this.database.transaction(async (connection) => {
      for (const listing of listings) {
        await insertListing(connection, listing);
      }
    });
  }

  async findPendingListings(): Promise<StoredListing[]> {
    const result = await this.database.query(
      `SELECT ${listingColumns}
       FROM listings
       WHERE notification_status = 'pending'
       ORDER BY first_discovered_at, deduplication_key`,
    );

    return mapStoredListings(result);
  }

  async markNotificationSent(
    deduplicationKeys: string[],
  ): Promise<void> {
    if (deduplicationKeys.length === 0) {
      return;
    }

    await this.database.query(
      `UPDATE listings
       SET notification_status = 'sent'
       WHERE deduplication_key = ANY($1::text[])
         AND notification_status = 'pending'`,
      [deduplicationKeys],
    );
  }
}

async function insertListing(
  connection: SqlConnection,
  record: StoredListing,
): Promise<void> {
  const listing = record.listing;
  await connection.query(insertListingSql, [
    record.deduplicationKey,
    listing.source,
    listing.sourceListingId,
    listing.mlsName,
    listing.mlsNumber,
    listing.formattedAddress,
    listing.addressLine1,
    listing.addressLine2,
    listing.city,
    listing.state,
    listing.zipCode,
    listing.latitude,
    listing.longitude,
    listing.propertyType,
    listing.bedrooms,
    listing.bathrooms,
    listing.price,
    listing.status,
    listing.listedDate,
    listing.lastSeenDate,
    listing.firstDiscoveredAt,
    record.notificationStatus,
  ]);
}

function mapStoredListings(result: SqlQueryResult): StoredListing[] {
  return result.rows.map(parseStoredListing);
}

function parseStoredListing(value: unknown): StoredListing {
  const row = readRecord(value);

  return {
    deduplicationKey: readString(row, "deduplication_key"),
    listing: parseNormalizedListing(row),
    notificationStatus: readNotificationStatus(row, "notification_status"),
  };
}

function readNotificationStatus(
  record: Record<string, unknown>,
  key: string,
): StoredListing["notificationStatus"] {
  const value = record[key];
  if (value === "baseline" || value === "pending" || value === "sent") {
    return value;
  }

  throwInvalidListingRowError();
}
