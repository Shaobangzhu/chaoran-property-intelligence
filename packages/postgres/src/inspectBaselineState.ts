import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

const baselineStateKey = "baseline_initialized";
const initialMigrationVersion = "001_initial_alert_schema";

export interface BaselineState {
  schemaReady: boolean;
  migrationApplied: boolean;
  baselineInitialized: boolean;
  baselineListings: number;
  pendingListings: number;
  sentListings: number;
}

export async function inspectBaselineState(
  database: SqlDatabase,
): Promise<BaselineState> {
  const schemaResult = await database.query(`
    SELECT
      to_regclass('public.alert_worker_state') IS NOT NULL
        AS state_table_exists,
      to_regclass('public.listings') IS NOT NULL
        AS listings_table_exists,
      to_regclass('public.schema_migrations') IS NOT NULL
        AS migrations_table_exists
  `);
  const schemaRow = readSingleRow(schemaResult);
  const schemaReady =
    readBoolean(schemaRow, "state_table_exists") &&
    readBoolean(schemaRow, "listings_table_exists") &&
    readBoolean(schemaRow, "migrations_table_exists");

  if (!schemaReady) {
    return {
      schemaReady: false,
      migrationApplied: false,
      baselineInitialized: false,
      baselineListings: 0,
      pendingListings: 0,
      sentListings: 0,
    };
  }

  const stateResult = await database.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM alert_worker_state
         WHERE state_key = $1
       ) AS baseline_initialized,
       EXISTS (
         SELECT 1
         FROM schema_migrations
         WHERE version = $2
       ) AS migration_applied,
       COUNT(*) FILTER (
         WHERE notification_status = 'baseline'
       )::integer AS baseline_listings,
       COUNT(*) FILTER (
         WHERE notification_status = 'pending'
       )::integer AS pending_listings,
       COUNT(*) FILTER (
         WHERE notification_status = 'sent'
       )::integer AS sent_listings
     FROM listings`,
    [baselineStateKey, initialMigrationVersion],
  );
  const stateRow = readSingleRow(stateResult);

  return {
    schemaReady: true,
    migrationApplied: readBoolean(stateRow, "migration_applied"),
    baselineInitialized: readBoolean(stateRow, "baseline_initialized"),
    baselineListings: readCount(stateRow, "baseline_listings"),
    pendingListings: readCount(stateRow, "pending_listings"),
    sentListings: readCount(stateRow, "sent_listings"),
  };
}

function readSingleRow(result: SqlQueryResult): Record<string, unknown> {
  const row = result.rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Baseline inspection returned an invalid database row");
  }

  return row as Record<string, unknown>;
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error("Baseline inspection returned an invalid database row");
  }

  return value;
}

function readCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Baseline inspection returned an invalid database row");
  }

  return value;
}
