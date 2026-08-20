import {
  UserEmailAlreadyExistsError,
  type CreateUserInput,
  type UserAuthenticationRecord,
  type UserRepositoryPort,
} from "@chaoran-property-intelligence/application";
import {
  isUserRole,
  isUserStatus,
  normalizeUserEmail,
  type UserAccount,
} from "@chaoran-property-intelligence/domain";

import type { SqlDatabase, SqlQueryResult } from "./sqlDatabase.js";

const userColumns = `
  id,
  normalized_email,
  role,
  status,
  created_at,
  updated_at
`;

export class PostgresUserRepository implements UserRepositoryPort {
  constructor(private readonly database: SqlDatabase) {}

  async createUser(input: CreateUserInput): Promise<UserAccount> {
    try {
      const result = await this.database.query(
        `INSERT INTO users (
           normalized_email,
           password_hash,
           role,
           status
         )
         VALUES ($1, $2, $3, $4)
         RETURNING ${userColumns}`,
        [
          input.normalizedEmail,
          input.passwordHash,
          input.role,
          input.status,
        ],
      );

      return parseRequiredUser(result);
    } catch (error) {
      if (isDuplicateNormalizedEmailError(error)) {
        throw new UserEmailAlreadyExistsError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<UserAccount | null> {
    const result = await this.database.query(
      `SELECT ${userColumns}
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    return parseOptionalUser(result);
  }

  async findByNormalizedEmail(
    normalizedEmail: CreateUserInput["normalizedEmail"],
  ): Promise<UserAuthenticationRecord | null> {
    const result = await this.database.query(
      `SELECT ${userColumns}, password_hash
       FROM users
       WHERE normalized_email = $1
       LIMIT 1`,
      [normalizedEmail],
    );

    if (result.rows.length === 0) {
      return null;
    }
    assertSingleRow(result);
    const row = readRecord(result.rows[0]);

    return {
      ...parseUserRow(row),
      passwordHash: readNonEmptyString(row, "password_hash"),
    };
  }
}

function parseRequiredUser(result: SqlQueryResult): UserAccount {
  assertSingleRow(result);
  return parseUserRow(readRecord(result.rows[0]));
}

function parseOptionalUser(result: SqlQueryResult): UserAccount | null {
  if (result.rows.length === 0) {
    return null;
  }
  assertSingleRow(result);
  return parseUserRow(readRecord(result.rows[0]));
}

function parseUserRow(row: Record<string, unknown>): UserAccount {
  const normalizedEmailValue = readNonEmptyString(row, "normalized_email");
  let normalizedEmail;
  try {
    normalizedEmail = normalizeUserEmail(normalizedEmailValue);
  } catch {
    return throwInvalidUserRowError();
  }
  if (normalizedEmail !== normalizedEmailValue) {
    return throwInvalidUserRowError();
  }

  const role = row.role;
  const status = row.status;
  if (!isUserRole(role) || !isUserStatus(status)) {
    return throwInvalidUserRowError();
  }

  return {
    id: readNonEmptyString(row, "id"),
    normalizedEmail,
    role,
    status,
    createdAt: readTimestamp(row, "created_at"),
    updatedAt: readTimestamp(row, "updated_at"),
  };
}

function assertSingleRow(result: SqlQueryResult): void {
  if (result.rows.length !== 1) {
    throwInvalidUserRowError();
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return throwInvalidUserRowError();
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    return throwInvalidUserRowError();
  }
  return value;
}

function readTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return throwInvalidUserRowError();
  }
  return value.toISOString();
}

function isDuplicateNormalizedEmailError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "users_normalized_email_unique"
  );
}

function throwInvalidUserRowError(): never {
  throw new Error("PostgreSQL user row did not match the expected schema");
}
