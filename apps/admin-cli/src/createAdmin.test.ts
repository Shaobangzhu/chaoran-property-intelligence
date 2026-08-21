import { describe, expect, it, vi } from "vitest";

import type {
  CreateUserInput,
  PasswordHasherPort,
  UserAuthenticationRecord,
  UserRepositoryPort,
} from "@chaoran-property-intelligence/application";
import type {
  NormalizedPassword,
  NormalizedUserEmail,
  UserAccount,
} from "@chaoran-property-intelligence/domain";
import type {
  PostgresConnectionConfig,
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import { createAdmin, type CreateAdminDependencies } from "./createAdmin.js";

describe("createAdmin", () => {
  it("runs migrations, creates the user, and closes the database", async () => {
    const database = new RecordingDatabase();
    const repository = new RecordingUserRepository();
    const dependencies = createDependencies(database, repository);

    const user = await createAdmin(
      {
        environment: {
          DATABASE_URL: "postgresql://localhost/cpi",
        },
        input: {
          email: "admin@example.com",
          password: "a unique password phrase",
        },
      },
      dependencies,
    );

    expect(dependencies.createDatabase).toHaveBeenCalledWith({
      kind: "connection-string",
      connectionString: "postgresql://localhost/cpi",
    });
    expect(dependencies.runMigrations).toHaveBeenCalledWith(database);
    expect(repository.createdUsers).toHaveLength(1);
    expect(database.close).toHaveBeenCalledOnce();
    expect(user).toEqual(createUser());
  });

  it("closes the database when migration fails", async () => {
    const database = new RecordingDatabase();
    const dependencies = createDependencies(
      database,
      new RecordingUserRepository(),
    );
    vi.mocked(dependencies.runMigrations).mockRejectedValueOnce(
      new Error("migration failed"),
    );

    await expect(
      createAdmin(
        {
          environment: { DATABASE_URL: "postgresql://localhost/cpi" },
          input: {
            email: "admin@example.com",
            password: "a unique password phrase",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("migration failed");

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("rejects missing database configuration before opening a connection", async () => {
    const database = new RecordingDatabase();
    const dependencies = createDependencies(
      database,
      new RecordingUserRepository(),
    );

    await expect(
      createAdmin(
        {
          environment: {},
          input: {
            email: "admin@example.com",
            password: "a unique password phrase",
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Missing required environment variable: DATABASE_URL");

    expect(dependencies.createDatabase).not.toHaveBeenCalled();
  });
});

class RecordingDatabase implements SqlDatabase {
  readonly close = vi.fn(async () => {});

  async query(): Promise<SqlQueryResult> {
    return { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

class RecordingPasswordHasher implements PasswordHasherPort {
  async hash(_password: NormalizedPassword): Promise<string> {
    return "$argon2id$test-hash";
  }

  async verify(): Promise<boolean> {
    throw new Error("Not used in this test");
  }
}

class RecordingUserRepository implements UserRepositoryPort {
  readonly createdUsers: CreateUserInput[] = [];

  async createUser(input: CreateUserInput): Promise<UserAccount> {
    this.createdUsers.push(input);
    return createUser();
  }

  async findById(): Promise<UserAccount | null> {
    throw new Error("Not used in this test");
  }

  async findByNormalizedEmail(): Promise<UserAuthenticationRecord | null> {
    throw new Error("Not used in this test");
  }
}

function createDependencies(
  database: RecordingDatabase,
  repository: RecordingUserRepository,
): CreateAdminDependencies {
  return {
    createDatabase: vi.fn(
      (_config: PostgresConnectionConfig): SqlDatabase => database,
    ),
    runMigrations: vi.fn(async () => {}),
    createRepository: vi.fn(() => repository),
    createPasswordHasher: vi.fn(() => new RecordingPasswordHasher()),
  };
}

function createUser(): UserAccount {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalizedEmail: "admin@example.com" as NormalizedUserEmail,
    role: "admin",
    status: "active",
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-20T19:00:00.000Z",
  };
}
