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

    expect(database.queries[2]?.text).toContain(
      "CREATE TABLE IF NOT EXISTS alert_worker_state",
    );
    expect(database.queries[2]?.text).toContain(
      "CREATE TABLE IF NOT EXISTS listings",
    );
    expect(database.queries[3]?.parameters).toEqual([
      "001_initial_alert_schema",
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
