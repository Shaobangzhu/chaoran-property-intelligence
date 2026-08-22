import {
  createPostgresDatabase,
  inspectPriceAlertState,
  type PostgresConnectionConfig,
  type PriceAlertState,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";

import { loadDatabaseConnectionConfig } from "./productionConfig.js";

export interface PriceAlertVerificationRuntime {
  environment: Readonly<Record<string, string | undefined>>;
}

export interface PriceAlertVerificationDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  inspectPriceAlerts(database: SqlDatabase): Promise<PriceAlertState>;
}

const defaultDependencies: PriceAlertVerificationDependencies = {
  createDatabase: createPostgresDatabase,
  inspectPriceAlerts: inspectPriceAlertState,
};

export async function verifyProductionPriceAlerts(
  runtime: PriceAlertVerificationRuntime,
  dependencies: PriceAlertVerificationDependencies = defaultDependencies,
): Promise<PriceAlertState> {
  const database = dependencies.createDatabase(
    loadDatabaseConnectionConfig(runtime.environment),
  );

  try {
    return await dependencies.inspectPriceAlerts(database);
  } finally {
    await database.close();
  }
}
