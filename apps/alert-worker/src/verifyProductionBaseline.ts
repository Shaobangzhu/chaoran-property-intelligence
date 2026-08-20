import {
  createPostgresDatabase,
  inspectBaselineState,
  type BaselineState,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";

import { loadDatabaseConnectionConfig } from "./productionConfig.js";

export interface BaselineVerificationRuntime {
  environment: Readonly<Record<string, string | undefined>>;
}

export interface BaselineVerificationDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  inspectBaseline(database: SqlDatabase): Promise<BaselineState>;
}

const defaultDependencies: BaselineVerificationDependencies = {
  createDatabase: createPostgresDatabase,
  inspectBaseline: inspectBaselineState,
};

export async function verifyProductionBaseline(
  runtime: BaselineVerificationRuntime,
  dependencies: BaselineVerificationDependencies = defaultDependencies,
): Promise<BaselineState> {
  const database = dependencies.createDatabase(
    loadDatabaseConnectionConfig(runtime.environment),
  );

  try {
    return await dependencies.inspectBaseline(database);
  } finally {
    await database.close();
  }
}
