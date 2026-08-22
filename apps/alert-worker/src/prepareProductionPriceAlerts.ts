import {
  createPostgresDatabase,
  PostgresListingAlertRepository,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";

import { loadDatabaseConnectionConfig } from "./productionConfig.js";

export interface PriceAlertPreparationRuntime {
  environment: Readonly<Record<string, string | undefined>>;
}

export interface PriceAlertPreparationRepository {
  initializeLegacyListingAlertState(): Promise<void>;
}

export interface PriceAlertPreparationDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  runMigrations(database: SqlDatabase): Promise<void>;
  createRepository(database: SqlDatabase): PriceAlertPreparationRepository;
}

const defaultDependencies: PriceAlertPreparationDependencies = {
  createDatabase: createPostgresDatabase,
  runMigrations: runBundledMigrations,
  createRepository(database) {
    return new PostgresListingAlertRepository(database);
  },
};

export async function prepareProductionPriceAlerts(
  runtime: PriceAlertPreparationRuntime,
  dependencies: PriceAlertPreparationDependencies = defaultDependencies,
): Promise<void> {
  const database = dependencies.createDatabase(
    loadDatabaseConnectionConfig(runtime.environment),
  );

  try {
    await dependencies.runMigrations(database);
    await dependencies
      .createRepository(database)
      .initializeLegacyListingAlertState();
  } finally {
    await database.close();
  }
}
