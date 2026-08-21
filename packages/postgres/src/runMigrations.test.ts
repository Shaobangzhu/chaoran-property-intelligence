import { describe, expect, it } from "vitest";

import { runBundledMigrations } from "./runBundledMigrations.js";
import { runMigrations } from "./runMigrations.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("runMigrations", () => {
  it("runs and records migrations that have not been applied", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
    ]);

    await runMigrations(database, [
      {
        version: "001_initial_alert_schema",
        sql: "CREATE TABLE example (id text PRIMARY KEY);",
      },
    ]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries.map((query) => query.text)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_migrations"),
      expect.stringContaining("SELECT version FROM schema_migrations"),
      "CREATE TABLE example (id text PRIMARY KEY);",
      expect.stringContaining("INSERT INTO schema_migrations"),
    ]);
    expect(database.queries[3]?.parameters).toEqual([
      "001_initial_alert_schema",
    ]);
  });

  it("skips migrations that were already applied", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [{ version: "001_initial_alert_schema" }] },
    ]);

    await runMigrations(database, [
      {
        version: "001_initial_alert_schema",
        sql: "CREATE TABLE example (id text PRIMARY KEY);",
      },
    ]);

    expect(database.transactionCount).toBe(0);
    expect(database.queries).toHaveLength(2);
  });

  it("loads the bundled SQL migration files", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
    ]);

    await runBundledMigrations(database);

    expect(database.transactionCount).toBe(4);
    expect(database.queries[2]?.text).toContain(
      "CREATE TABLE IF NOT EXISTS alert_worker_state",
    );
    expect(database.queries[2]?.text).toContain(
      "CREATE TABLE IF NOT EXISTS listings",
    );
    expect(database.queries[3]?.parameters).toEqual([
      "001_initial_alert_schema",
    ]);
    expect(database.queries[4]?.text).toContain(
      "ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid()",
    );
    expect(database.queries[4]?.text).toContain(
      "PRIMARY KEY (id)",
    );
    expect(database.queries[4]?.text).toContain(
      "UNIQUE (deduplication_key)",
    );
    expect(database.queries[5]?.parameters).toEqual([
      "002_add_listing_identity",
    ]);
    expect(database.queries[6]?.text).toContain("CREATE TABLE users");
    expect(database.queries[6]?.text).toContain(
      "CONSTRAINT users_normalized_email_unique",
    );
    expect(database.queries[6]?.text).toContain(
      "CHECK (role IN ('admin'))",
    );
    expect(database.queries[6]?.text).toContain(
      "CHECK (status IN ('active', 'disabled'))",
    );
    expect(database.queries[7]?.parameters).toEqual(["003_create_users"]);
    expect(database.queries[8]?.text).toContain(
      "CHECK (source IN ('rentcast', 'manual'))",
    );
    expect(database.queries[8]?.text).toContain(
      "ADD COLUMN created_by_user_id uuid",
    );
    expect(database.queries[8]?.text).toContain(
      "notification_status IN ('baseline', 'pending', 'sent', 'not_applicable')",
    );
    expect(database.queries[8]?.text).toContain(
      "CONSTRAINT listings_source_identity_check",
    );
    expect(database.queries[8]?.text).toContain(
      "CONSTRAINT listings_source_facts_check",
    );
    expect(database.queries[8]?.text).toContain(
      "CONSTRAINT listings_coordinates_check",
    );
    expect(database.queries[9]?.parameters).toEqual([
      "004_support_manual_listings",
    ]);
  });

  it("applies the remaining bundled migrations when the initial schema exists", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [{ version: "001_initial_alert_schema" }] },
    ]);

    await runBundledMigrations(database);

    expect(database.transactionCount).toBe(3);
    expect(database.queries[2]?.text).toContain(
      "ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid()",
    );
    expect(database.queries[3]?.parameters).toEqual([
      "002_add_listing_identity",
    ]);
    expect(database.queries[4]?.text).toContain("CREATE TABLE users");
    expect(database.queries[5]?.parameters).toEqual(["003_create_users"]);
    expect(database.queries[6]?.text).toContain(
      "CHECK (source IN ('rentcast', 'manual'))",
    );
    expect(database.queries[7]?.parameters).toEqual([
      "004_support_manual_listings",
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

  constructor(private readonly responses: SqlQueryResult[]) {}

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
