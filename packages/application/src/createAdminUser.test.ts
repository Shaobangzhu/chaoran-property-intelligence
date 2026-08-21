import { describe, expect, it } from "vitest";

import type {
  NormalizedPassword,
  NormalizedUserEmail,
  UserAccount,
} from "@chaoran-property-intelligence/domain";

import { CreateAdminUser } from "./createAdminUser.js";
import type { PasswordHasherPort } from "./passwordHasher.js";
import type {
  CreateUserInput,
  UserAuthenticationRecord,
  UserRepositoryPort,
} from "./userRepository.js";

describe("CreateAdminUser", () => {
  it("normalizes input, hashes the validated password, and creates an active admin", async () => {
    const repository = new RecordingUserRepository();
    const passwordHasher = new RecordingPasswordHasher();
    const useCase = new CreateAdminUser({ repository, passwordHasher });

    const user = await useCase.execute({
      email: "  Admin@Example.COM  ",
      password: "  all lowercase phrase  ",
    });

    expect(passwordHasher.hashedPasswords).toEqual([
      "  all lowercase phrase  ",
    ]);
    expect(repository.createdUsers).toEqual([
      {
        normalizedEmail: "admin@example.com",
        passwordHash: "$argon2id$test-hash",
        role: "admin",
        status: "active",
      },
    ]);
    expect(user).toEqual(createUser());
  });

  it("rejects an invalid password before hashing or persistence", async () => {
    const repository = new RecordingUserRepository();
    const passwordHasher = new RecordingPasswordHasher();
    const useCase = new CreateAdminUser({ repository, passwordHasher });

    await expect(
      useCase.execute({
        email: "admin@example.com",
        password: "passwordpassword",
      }),
    ).rejects.toThrow("Password is too common or context-specific");

    expect(passwordHasher.hashedPasswords).toEqual([]);
    expect(repository.createdUsers).toEqual([]);
  });
});

class RecordingPasswordHasher implements PasswordHasherPort {
  readonly hashedPasswords: string[] = [];

  async hash(password: NormalizedPassword): Promise<string> {
    this.hashedPasswords.push(password);
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
