import { describe, expect, it } from "vitest";

import {
  UserEmailAlreadyExistsError,
  type CreateUserInput,
} from "@chaoran-property-intelligence/application";
import { normalizeUserEmail } from "@chaoran-property-intelligence/domain";

import { PostgresUserRepository } from "./postgresUserRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresUserRepository", () => {
  it("creates an active administrator and returns no password hash", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createUserRow()] },
    ]);
    const repository = new PostgresUserRepository(database);
    const input = createUserInput();

    const user = await repository.createUser(input);

    expect(database.queries[0]?.text).toContain("INSERT INTO users");
    expect(database.queries[0]?.text).not.toContain("RETURNING password_hash");
    expect(database.queries[0]?.parameters).toEqual([
      "admin@example.com",
      "$argon2id$v=19$test-hash",
      "admin",
      "active",
    ]);
    expect(user).toEqual(createExpectedUser());
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("returns authentication data by normalized email", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createUserRow()] },
    ]);
    const repository = new PostgresUserRepository(database);

    const user = await repository.findByNormalizedEmail(
      normalizeUserEmail("ADMIN@example.com"),
    );

    expect(database.queries[0]?.parameters).toEqual(["admin@example.com"]);
    expect(user).toEqual({
      ...createExpectedUser(),
      passwordHash: "$argon2id$v=19$test-hash",
    });
  });

  it("returns the public user record by id without selecting a hash", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createUserRow({ password_hash: undefined })] },
    ]);
    const repository = new PostgresUserRepository(database);

    const user = await repository.findById(
      "0198c7d2-7668-7775-b0fc-b789690a60c1",
    );

    expect(database.queries[0]?.text).not.toContain("password_hash");
    expect(user).toEqual(createExpectedUser());
  });

  it("returns null when a user lookup has no result", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresUserRepository(database);

    await expect(
      repository.findByNormalizedEmail(normalizeUserEmail("none@example.com")),
    ).resolves.toBeNull();
    await expect(repository.findById("missing-id")).resolves.toBeNull();
  });

  it("translates only the normalized-email uniqueness violation", async () => {
    const database = new RecordingSqlDatabase();
    database.error = {
      code: "23505",
      constraint: "users_normalized_email_unique",
    };
    const repository = new PostgresUserRepository(database);

    await expect(repository.createUser(createUserInput())).rejects.toThrow(
      UserEmailAlreadyExistsError,
    );
  });

  it("does not hide unrelated PostgreSQL errors", async () => {
    const database = new RecordingSqlDatabase();
    const databaseError = { code: "08006", message: "connection failed" };
    database.error = databaseError;
    const repository = new PostgresUserRepository(database);

    await expect(repository.createUser(createUserInput())).rejects.toBe(
      databaseError,
    );
  });

  it.each([
    { role: "viewer" },
    { status: "deleted" },
    { normalized_email: " Admin@Example.com " },
    { created_at: "not-a-date" },
    { password_hash: null },
  ])("rejects a malformed user row: %o", async (override) => {
    const database = new RecordingSqlDatabase([
      { rows: [createUserRow(override)] },
    ]);
    const repository = new PostgresUserRepository(database);

    await expect(
      repository.findByNormalizedEmail(normalizeUserEmail("admin@example.com")),
    ).rejects.toThrow(
      "PostgreSQL user row did not match the expected schema",
    );
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  error: unknown;

  constructor(private readonly responses: SqlQueryResult[] = []) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createUserInput(): CreateUserInput {
  return {
    normalizedEmail: normalizeUserEmail("admin@example.com"),
    passwordHash: "$argon2id$v=19$test-hash",
    role: "admin",
    status: "active",
  };
}

function createExpectedUser() {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalizedEmail: "admin@example.com",
    role: "admin" as const,
    status: "active" as const,
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-20T19:00:00.000Z",
  };
}

function createUserRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalized_email: "admin@example.com",
    password_hash: "$argon2id$v=19$test-hash",
    role: "admin",
    status: "active",
    created_at: new Date("2026-08-20T19:00:00.000Z"),
    updated_at: new Date("2026-08-20T19:00:00.000Z"),
    ...overrides,
  };
}
