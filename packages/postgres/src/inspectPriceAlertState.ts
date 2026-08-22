import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

const priceAlertMigrationVersion = "006_create_listing_alert_state";
const priceObservationBaselineStateKey =
  "price_observation_baseline_initialized";

export interface PriceAlertState {
  schemaReady: boolean;
  migrationApplied: boolean;
  baselineInitialized: boolean;
  priceObservations: number;
  pendingEvents: number;
  sentEvents: number;
}

export async function inspectPriceAlertState(
  database: SqlDatabase,
): Promise<PriceAlertState> {
  const schemaResult = await database.query(`
    SELECT
      to_regclass('public.alert_worker_state') IS NOT NULL
        AS state_table_exists,
      to_regclass('public.schema_migrations') IS NOT NULL
        AS migrations_table_exists,
      to_regclass('public.listing_price_observations') IS NOT NULL
        AS observations_table_exists,
      to_regclass('public.listing_alert_events') IS NOT NULL
        AS events_table_exists
  `);
  const schemaRow = readSingleRow(schemaResult);
  const migrationsTableExists = readBoolean(
    schemaRow,
    "migrations_table_exists",
  );
  const schemaReady =
    readBoolean(schemaRow, "state_table_exists") &&
    migrationsTableExists &&
    readBoolean(schemaRow, "observations_table_exists") &&
    readBoolean(schemaRow, "events_table_exists");

  if (!migrationsTableExists) {
    return emptyState(false, false);
  }

  const migrationResult = await database.query(
    `SELECT EXISTS (
       SELECT 1
       FROM schema_migrations
       WHERE version = $1
     ) AS migration_applied`,
    [priceAlertMigrationVersion],
  );
  const migrationApplied = readBoolean(
    readSingleRow(migrationResult),
    "migration_applied",
  );

  if (!schemaReady) {
    return emptyState(false, migrationApplied);
  }

  const aggregateResult = await database.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM alert_worker_state
         WHERE state_key = $1
       ) AS baseline_initialized,
       (SELECT COUNT(*)::integer FROM listing_price_observations)
         AS price_observations,
       (SELECT COUNT(*)::integer FROM listing_alert_events
        WHERE status = 'pending') AS pending_events,
       (SELECT COUNT(*)::integer FROM listing_alert_events
        WHERE status = 'sent') AS sent_events`,
    [priceObservationBaselineStateKey],
  );
  const aggregateRow = readSingleRow(aggregateResult);

  return {
    schemaReady: true,
    migrationApplied,
    baselineInitialized: readBoolean(
      aggregateRow,
      "baseline_initialized",
    ),
    priceObservations: readCount(aggregateRow, "price_observations"),
    pendingEvents: readCount(aggregateRow, "pending_events"),
    sentEvents: readCount(aggregateRow, "sent_events"),
  };
}

function emptyState(
  schemaReady: boolean,
  migrationApplied: boolean,
): PriceAlertState {
  return {
    schemaReady,
    migrationApplied,
    baselineInitialized: false,
    priceObservations: 0,
    pendingEvents: 0,
    sentEvents: 0,
  };
}

function readSingleRow(result: SqlQueryResult): Record<string, unknown> {
  const row = result.rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Price-alert inspection returned an invalid database row");
  }

  return row as Record<string, unknown>;
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error("Price-alert inspection returned an invalid database row");
  }

  return value;
}

function readCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Price-alert inspection returned an invalid database row");
  }

  return value;
}
