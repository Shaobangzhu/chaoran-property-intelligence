import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

export interface Migration {
  version: string;
  sql: string;
}

export async function runMigrations(
  database: SqlDatabase,
  migrations: Migration[],
): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedResult = await database.query(
    "SELECT version FROM schema_migrations",
  );
  const appliedVersions = parseAppliedVersions(appliedResult);

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await database.transaction(async (connection) => {
      await connection.query(migration.sql);
      await connection.query(
        `INSERT INTO schema_migrations (version)
         VALUES ($1)`,
        [migration.version],
      );
    });
  }
}

function parseAppliedVersions(result: SqlQueryResult): Set<string> {
  return new Set(
    result.rows.map((row) => {
      if (
        typeof row !== "object" ||
        row === null ||
        !("version" in row) ||
        typeof row.version !== "string"
      ) {
        throw new Error(
          "PostgreSQL migration row did not match the expected schema",
        );
      }

      return row.version;
    }),
  );
}
