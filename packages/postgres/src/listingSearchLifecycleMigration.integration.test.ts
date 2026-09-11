import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresListingQuery } from "./postgresListingQuery.js";
import { runBundledMigrations } from "./runBundledMigrations.js";
import { runMigrations, type Migration } from "./runMigrations.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const disposableConnectionString = readDisposableConnectionString();
const describeWithDisposablePostgres =
  disposableConnectionString === null ? describe.skip : describe;

describeWithDisposablePostgres(
  "listing search lifecycle migration against disposable PostgreSQL",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({
        connectionString: requireDisposableConnectionString(),
        max: 1,
      });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("supports fresh install and a second idempotent bundled run", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runBundledMigrations(database);
        await runBundledMigrations(database);

        await expect(migrationCount(database)).resolves.toBe(8);
        await expect(tableName(database, "listing_search_runs")).resolves.toBe(
          "listing_search_runs",
        );
        await expect(
          tableName(database, "listing_search_memberships"),
        ).resolves.toBe("listing_search_memberships");
        await expect(
          versionCount(
            database,
            "008_create_listing_search_runs_and_memberships",
          ),
        ).resolves.toBe(1);
      });
    });

    it("upgrades version 007 without backfill and enforces lifecycle constraints", async () => {
      await withIsolatedSchema(pool, async (database) => {
        await runMigrations(database, await loadPreFeatureMigrations());
        const listingId = await seedHistoricalRentCastListing(database);

        await expect(tableName(database, "listing_search_runs")).resolves.toBeNull();
        await runBundledMigrations(database);

        await expect(rowCount(database, "listings")).resolves.toBe(1);
        await expect(
          rowCount(database, "listing_search_memberships"),
        ).resolves.toBe(0);

        const successfulRunId = randomUUID();
        await insertSuccessfulRun(database, successfulRunId);
        await insertCurrentMembership(database, successfulRunId, listingId);

        await expect(
          database.query(`
            UPDATE listing_search_memberships
            SET lifecycle_state = 'missing'
            WHERE listing_id = $1
          `, [listingId]),
        ).rejects.toMatchObject({ code: "23514" });

        await expect(
          database.query(`
            UPDATE listing_search_memberships
            SET applied_revision = 2
            WHERE listing_id = $1
          `, [listingId]),
        ).rejects.toMatchObject({ code: "23503" });

        await expect(
          database.query(`
            UPDATE listing_search_memberships
            SET lifecycle_state = 'sold'
            WHERE listing_id = $1
          `, [listingId]),
        ).rejects.toMatchObject({ code: "23514" });

        await expect(
          database.query(`
            INSERT INTO listing_search_runs (
              run_id,
              profile_key,
              requested_revision,
              trigger_reason,
              requested_at,
              selected_markets,
              selected_market_count,
              planned_provider_request_count
            ) VALUES (
              $1,
              'primary',
              10,
              'manual-retry',
              now(),
              '["Irvine", "Irvine"]',
              2,
              2
            )
          `, [randomUUID()]),
        ).rejects.toMatchObject({ code: "23514" });

        const firstCriteriaRunId = randomUUID();
        await insertQueuedRun(database, firstCriteriaRunId, 2, "criteria-change");
        await expect(
          insertQueuedRun(database, randomUUID(), 2, "criteria-change"),
        ).rejects.toMatchObject({ code: "23505" });

        await insertRunningRun(database, randomUUID(), 3);
        await expect(
          insertRunningRun(database, randomUUID(), 4),
        ).rejects.toMatchObject({ code: "23505" });

        await expect(
          database.query(`
            UPDATE listing_search_runs
            SET status = 'succeeded'
            WHERE run_id = $1
          `, [firstCriteriaRunId]),
        ).rejects.toMatchObject({ code: "23514" });

        const legacyListings = await new PostgresListingQuery(
          database,
        ).listListings();
        expect(legacyListings).toHaveLength(1);
        expect(legacyListings[0]).toMatchObject({
          id: listingId,
          listing: {
            source: "rentcast",
            sourceListingId: "migration-rentcast-1",
          },
        });

        await runBundledMigrations(database);
        await expect(migrationCount(database)).resolves.toBe(8);
        await expect(
          versionCount(
            database,
            "008_create_listing_search_runs_and_memberships",
          ),
        ).resolves.toBe(1);
      });
    });
  },
);

async function withIsolatedSchema(
  pool: pg.Pool,
  operation: (database: SqlDatabase) => Promise<void>,
): Promise<void> {
  const schema = `cpi_migration_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  const database = new PinnedSqlDatabase(client);
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await operation(database);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
}

class PinnedSqlDatabase implements SqlDatabase {
  constructor(private readonly client: pg.PoolClient) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    const result = await this.client.query(text, [...parameters]);
    return { rows: result.rows };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const result = await operation(this);
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {}
}

async function loadPreFeatureMigrations(): Promise<Migration[]> {
  const versions = [
    "001_initial_alert_schema",
    "002_add_listing_identity",
    "003_create_users",
    "004_support_manual_listings",
    "005_create_current_showing_list_draft",
    "006_create_listing_alert_state",
    "007_create_listing_search_profile",
  ];
  return Promise.all(
    versions.map(async (version) => ({
      version,
      sql: await readFile(
        new URL(`../migrations/${version}.sql`, import.meta.url),
        "utf8",
      ),
    })),
  );
}

async function seedHistoricalRentCastListing(
  database: SqlDatabase,
): Promise<string> {
  const result = await database.query(`
    INSERT INTO listings (
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
    ) VALUES (
      'rentcast:migration-rentcast-1',
      'rentcast',
      'migration-rentcast-1',
      'CRMLS',
      'MIGRATION1',
      '123 Migration Way, Chino, CA 91710',
      '123 Migration Way',
      NULL,
      'Chino',
      'CA',
      '91710',
      34.0123,
      -117.6889,
      'Single Family',
      4,
      3,
      825000,
      'Active',
      '2026-09-01',
      '2026-09-07',
      '2026-09-07T15:00:00.000Z',
      'baseline'
    )
    RETURNING id
  `);
  return readSingleString(result.rows, "id");
}

async function insertSuccessfulRun(
  database: SqlDatabase,
  runId: string,
): Promise<void> {
  await database.query(`
    INSERT INTO listing_search_runs (
      run_id,
      profile_key,
      requested_revision,
      effective_revision,
      trigger_reason,
      status,
      claim_token,
      requested_at,
      started_at,
      completed_at,
      selected_markets,
      selected_market_count,
      planned_provider_request_count,
      actual_provider_request_count,
      returned_listing_count,
      published_current_count
    ) VALUES (
      $1,
      'primary',
      1,
      1,
      'scheduled',
      'succeeded',
      $2,
      now(),
      now(),
      now(),
      '["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"]',
      5,
      5,
      5,
      1,
      1
    )
  `, [runId, randomUUID()]);
}

async function insertCurrentMembership(
  database: SqlDatabase,
  runId: string,
  listingId: string,
): Promise<void> {
  await database.query(`
    INSERT INTO listing_search_memberships (
      profile_key,
      listing_id,
      applied_revision,
      last_successful_run_id,
      lifecycle_state,
      first_matched_at,
      last_matched_at,
      last_server_observed_at,
      consecutive_complete_run_absence_count,
      inactive_at,
      lifecycle_changed_at
    ) VALUES (
      'primary',
      $1,
      1,
      $2,
      'current',
      now(),
      now(),
      now(),
      0,
      NULL,
      now()
    )
  `, [listingId, runId]);
}

async function insertQueuedRun(
  database: SqlDatabase,
  runId: string,
  revision: number,
  triggerReason: "criteria-change" | "scheduled" | "manual-retry",
): Promise<void> {
  await database.query(`
    INSERT INTO listing_search_runs (
      run_id,
      profile_key,
      requested_revision,
      trigger_reason,
      status,
      requested_at,
      selected_markets,
      selected_market_count,
      planned_provider_request_count
    ) VALUES ($1, 'primary', $2, $3, 'queued', now(), '["Irvine"]', 1, 1)
  `, [runId, revision, triggerReason]);
}

async function insertRunningRun(
  database: SqlDatabase,
  runId: string,
  revision: number,
): Promise<void> {
  await database.query(`
    INSERT INTO listing_search_runs (
      run_id,
      profile_key,
      requested_revision,
      effective_revision,
      trigger_reason,
      status,
      claim_token,
      requested_at,
      started_at,
      selected_markets,
      selected_market_count,
      planned_provider_request_count
    ) VALUES (
      $1,
      'primary',
      $2,
      $2,
      'manual-retry',
      'running',
      $3,
      now(),
      now(),
      '["Irvine"]',
      1,
      1
    )
  `, [runId, revision, randomUUID()]);
}

async function migrationCount(database: SqlDatabase): Promise<number> {
  const result = await database.query(
    "SELECT count(*)::integer AS count FROM schema_migrations",
  );
  return readSingleNumber(result.rows, "count");
}

async function versionCount(
  database: SqlDatabase,
  version: string,
): Promise<number> {
  const result = await database.query(
    `SELECT count(*)::integer AS count
     FROM schema_migrations
     WHERE version = $1`,
    [version],
  );
  return readSingleNumber(result.rows, "count");
}

async function tableName(
  database: SqlDatabase,
  name: string,
): Promise<string | null> {
  const result = await database.query(
    "SELECT to_regclass($1)::text AS table_name",
    [name],
  );
  const row = result.rows[0];
  if (typeof row !== "object" || row === null || !("table_name" in row)) {
    throw new Error("Disposable PostgreSQL table lookup was malformed");
  }
  if (row.table_name !== null && typeof row.table_name !== "string") {
    throw new Error("Disposable PostgreSQL table name was malformed");
  }
  return row.table_name;
}

async function rowCount(
  database: SqlDatabase,
  table: "listings" | "listing_search_memberships",
): Promise<number> {
  const result = await database.query(
    `SELECT count(*)::integer AS count FROM ${table}`,
  );
  return readSingleNumber(result.rows, "count");
}

function readSingleNumber(rows: readonly unknown[], key: string): number {
  const value = readSingleValue(rows, key);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Disposable PostgreSQL count was malformed");
  }
  return value;
}

function readSingleString(rows: readonly unknown[], key: string): string {
  const value = readSingleValue(rows, key);
  if (typeof value !== "string") {
    throw new Error("Disposable PostgreSQL identifier was malformed");
  }
  return value;
}

function readSingleValue(rows: readonly unknown[], key: string): unknown {
  const row = rows[0];
  if (typeof row !== "object" || row === null || !(key in row)) {
    throw new Error("Disposable PostgreSQL result was malformed");
  }
  return (row as Record<string, unknown>)[key];
}

function readDisposableConnectionString(): string | null {
  if (process.env.CPI_RUN_DISPOSABLE_POSTGRES_TESTS !== "true") {
    return null;
  }
  const connectionString = process.env.CPI_DISPOSABLE_POSTGRES_URL;
  if (connectionString === undefined) {
    throw new Error("CPI_DISPOSABLE_POSTGRES_URL is required");
  }
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.startsWith("cpi_disposable_")) {
    throw new Error(
      "Disposable migration tests require a cpi_disposable_ database",
    );
  }
  return connectionString;
}

function requireDisposableConnectionString(): string {
  if (disposableConnectionString === null) {
    throw new Error("Disposable PostgreSQL tests were not enabled");
  }
  return disposableConnectionString;
}
