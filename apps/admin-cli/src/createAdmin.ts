import {
  CreateAdminUser,
  type CreateAdminUserInput,
  type PasswordHasherPort,
  type UserRepositoryPort,
} from "@chaoran-property-intelligence/application";
import { Argon2idPasswordHasher } from "@chaoran-property-intelligence/auth";
import type { UserAccount } from "@chaoran-property-intelligence/domain";
import {
  createPostgresDatabase,
  PostgresUserRepository,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";

export interface CreateAdminRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  input: CreateAdminUserInput;
  runMigrations?: boolean;
}

export interface CreateAdminDependencies {
  createDatabase(config: PostgresConnectionConfig): SqlDatabase;
  runMigrations(database: SqlDatabase): Promise<void>;
  createRepository(database: SqlDatabase): UserRepositoryPort;
  createPasswordHasher(): PasswordHasherPort;
}

const productionDependencies: CreateAdminDependencies = {
  createDatabase(config) {
    return createPostgresDatabase(config, {
      applicationName: "chaoran-property-admin-cli",
    });
  },
  runMigrations: runBundledMigrations,
  createRepository(database) {
    return new PostgresUserRepository(database);
  },
  createPasswordHasher() {
    return new Argon2idPasswordHasher();
  },
};

export async function createAdmin(
  runtime: CreateAdminRuntime,
  dependencies: CreateAdminDependencies = productionDependencies,
): Promise<UserAccount> {
  const databaseConfig = loadDatabaseConfig(runtime.environment);
  const database = dependencies.createDatabase(databaseConfig);

  try {
    if (runtime.runMigrations ?? true) {
      await dependencies.runMigrations(database);
    }
    const useCase = new CreateAdminUser({
      repository: dependencies.createRepository(database),
      passwordHasher: dependencies.createPasswordHasher(),
    });

    return await useCase.execute(runtime.input);
  } finally {
    await database.close();
  }
}

function loadDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): PostgresConnectionConfig {
  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return {
      kind: "connection-string",
      connectionString: databaseUrl,
    };
  }

  const host = readRequiredParameter(environment, "PGHOST");
  const database = readRequiredParameter(environment, "PGDATABASE");
  const user = readRequiredParameter(environment, "PGUSER");
  const password = readRequiredParameter(environment, "PGPASSWORD");
  const portValue = readRequiredParameter(environment, "PGPORT");
  if (environment.PGSSLMODE !== "verify-full") {
    throw new Error("PGSSLMODE must be verify-full");
  }
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PGPORT must be a valid TCP port");
  }

  return {
    kind: "parameters",
    host,
    port,
    database,
    user,
    password,
    ssl: true,
  };
}

function readRequiredParameter(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      "Missing required database configuration: DATABASE_URL or PostgreSQL parameters",
    );
  }
  return value;
}
