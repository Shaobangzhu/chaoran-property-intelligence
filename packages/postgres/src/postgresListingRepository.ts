import type {
  ListingRepositoryPort,
  NormalizedListing,
  StoredListing,
} from "@chaoran-property-intelligence/application";

import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const baselineStateKey = "baseline_initialized";

const listingColumns = `
  deduplication_key,
  source,
  source_listing_id,
  mls_name,
  mls_number,
  formatted_address,
  address_line_1,
  address_line_2,
  city,
  state,
  zip_code,
  latitude,
  longitude,
  property_type,
  bedrooms,
  bathrooms,
  price,
  status,
  listed_date,
  last_seen_date,
  first_discovered_at,
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

function parseNormalizedListing(
  row: Record<string, unknown>,
): NormalizedListing {
  const source = readString(row, "source");
  if (source !== "rentcast") {
    throwInvalidRowError();
  }

  return {
    source,
    sourceListingId: readString(row, "source_listing_id"),
    mlsName: readNullableString(row, "mls_name"),
    mlsNumber: readNullableString(row, "mls_number"),
    formattedAddress: readString(row, "formatted_address"),
    addressLine1: readString(row, "address_line_1"),
    addressLine2: readNullableString(row, "address_line_2"),
    city: readString(row, "city"),
    state: readString(row, "state"),
    zipCode: readString(row, "zip_code"),
    latitude: readNumber(row, "latitude"),
    longitude: readNumber(row, "longitude"),
    propertyType: readString(row, "property_type"),
    bedrooms: readNumber(row, "bedrooms"),
    bathrooms: readNumber(row, "bathrooms"),
    price: readNumber(row, "price"),
    status: readString(row, "status"),
    listedDate: readString(row, "listed_date"),
    lastSeenDate: readString(row, "last_seen_date"),
    firstDiscoveredAt: readString(row, "first_discovered_at"),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwInvalidRowError();
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throwInvalidRowError();
  }

  return value;
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null || typeof value === "string") {
    return value;
  }

  throwInvalidRowError();
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalidRowError();
  }

  return value;
}

function readNotificationStatus(
  record: Record<string, unknown>,
  key: string,
): StoredListing["notificationStatus"] {
  const value = record[key];
  if (value === "baseline" || value === "pending" || value === "sent") {
    return value;
  }

  throwInvalidRowError();
}

function throwInvalidRowError(): never {
  throw new Error("PostgreSQL listing row did not match the expected schema");
}
