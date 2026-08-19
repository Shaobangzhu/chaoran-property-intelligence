import { readdir, readFile } from "node:fs/promises";

import { runMigrations, type Migration } from "./runMigrations.js";
import type { SqlDatabase } from "./sqlDatabase.js";

const migrationsDirectory = new URL("../migrations/", import.meta.url);

export async function runBundledMigrations(
  database: SqlDatabase,
): Promise<void> {
  const migrations = await loadSqlMigrations(migrationsDirectory);
  await runMigrations(database, migrations);
}

async function loadSqlMigrations(directory: URL): Promise<Migration[]> {
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  return Promise.all(
    fileNames.map(async (fileName) => ({
      version: fileName.slice(0, -".sql".length),
      sql: await readFile(new URL(fileName, directory), "utf8"),
    })),
  );
}
