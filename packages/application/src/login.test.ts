import { describe, expect, it } from "vitest";

import type {
  NormalizedPassword,
  NormalizedUserEmail,
  UserAccount,
} from "@chaoran-property-intelligence/domain";

import {
  InvalidCredentialsError,
  Login,
  type LoginOptions,
} from "./login.js";
import type { PasswordHasherPort } from "./passwordHasher.js";
import type {
  IssuedAccessToken,
  IssueAccessTokenInput,
  TokenServicePort,
  VerifiedAccessToken,
} from "./tokenService.js";
import type {
  CreateUserInput,
  UserAuthenticationRecord,
  UserRepositoryPort,
} from "./userRepository.js";

const dummyPasswordHash = "$argon2id$dummy-hash";
const storedPasswordHash = "$argon2id$stored-hash";

describe("Login", () => {
  it("normalizes credentials, verifies once, and issues a token for an active user", async () => {
    const repository = new RecordingUserRepository(createAuthenticationRecord());
    const passwordHasher = new RecordingPasswordHasher(true);
    const tokenService = new RecordingTokenService();
    const login = createLogin({ repository, passwordHasher, tokenService });

    const result = await login.execute({
      email: "  Admin@Example.COM  ",
      password: "Cafe\u0301 login password",
    });

    expect(repository.lookedUpEmails).toEqual(["admin@example.com"]);
    expect(passwordHasher.verifications).toEqual([
      {
        password: "Caf\u00e9 login password",
        passwordHash: storedPasswordHash,
      },
    ]);
    expect(tokenService.issuedInputs).toEqual([
      {
        userId: "0198c7d2-7668-7775-b0fc-b789690a60c1",
        role: "admin",
      },
    ]);
    expect(result).toEqual({
      user: {
        id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
        normalizedEmail: "admin@example.com",
        role: "admin",
      },
      accessToken: {
        token: "issued-access-token",
        expiresAtEpochSeconds: 1_777_777_777,
      },
    });
    expect(result).not.toHaveProperty("user.passwordHash");
  });

  it("performs one dummy-hash verification for an unknown email", async () => {
    const repository = new RecordingUserRepository(null);
    const passwordHasher = new RecordingPasswordHasher(false);
    const tokenService = new RecordingTokenService();
    const login = createLogin({ repository, passwordHasher, tokenService });

    await expect(
      login.execute({
        email: "unknown@example.com",
        password: "unknown user password",
      }),
    ).rejects.toEqual(new InvalidCredentialsError());

    expect(passwordHasher.verifications).toEqual([
      {
        password: "unknown user password",
        passwordHash: dummyPasswordHash,
      },
    ]);
    expect(tokenService.issuedInputs).toEqual([]);
  });

  it("uses the dummy-hash path for a malformed email", async () => {
    const repository = new RecordingUserRepository(null);
    const passwordHasher = new RecordingPasswordHasher(false);
    const login = createLogin({ repository, passwordHasher });

    await expect(
      login.execute({
        email: "not-an-email",
        password: "malformed email password",
      }),
    ).rejects.toEqual(new InvalidCredentialsError());

    expect(repository.lookedUpEmails).toEqual([]);
    expect(passwordHasher.verifications).toEqual([
      {
        password: "malformed email password",
        passwordHash: dummyPasswordHash,
      },
    ]);
  });

  it.each([
    ["wrong password", createAuthenticationRecord(), false],
    [
      "disabled user",
      createAuthenticationRecord({ status: "disabled" }),
      true,
    ],
  ])("returns the same failure for %s", async (_label, user, passwordMatches) => {
    const passwordHasher = new RecordingPasswordHasher(passwordMatches);
    const tokenService = new RecordingTokenService();
    const login = createLogin({
      repository: new RecordingUserRepository(user),
      passwordHasher,
      tokenService,
    });

    await expect(
      login.execute({
        email: "admin@example.com",
        password: "candidate password",
      }),
    ).rejects.toEqual(new InvalidCredentialsError());

    expect(passwordHasher.verifications).toHaveLength(1);
    expect(passwordHasher.verifications[0]?.passwordHash).toBe(
      storedPasswordHash,
    );
    expect(tokenService.issuedInputs).toEqual([]);
  });

  it("rejects an unbounded password without invoking the expensive hasher", async () => {
    const repository = new RecordingUserRepository(createAuthenticationRecord());
    const passwordHasher = new RecordingPasswordHasher(true);
    const login = createLogin({ repository, passwordHasher });

    await expect(
      login.execute({
        email: "admin@example.com",
        password: "too short",
      }),
    ).rejects.toEqual(new InvalidCredentialsError());

    expect(repository.lookedUpEmails).toEqual([]);
    expect(passwordHasher.verifications).toEqual([]);
  });

  it("does not hide repository or password-hasher failures as credential failures", async () => {
    const repositoryFailure = new Error("database unavailable");
    const repository = new RecordingUserRepository(null, repositoryFailure);
    const login = createLogin({ repository });

    await expect(
      login.execute({
        email: "admin@example.com",
        password: "candidate password",
      }),
    ).rejects.toBe(repositoryFailure);

    const hasherFailure = new Error("hasher unavailable");
    const passwordHasher = new RecordingPasswordHasher(false, hasherFailure);
    const secondLogin = createLogin({
      repository: new RecordingUserRepository(createAuthenticationRecord()),
      passwordHasher,
    });

    await expect(
      secondLogin.execute({
        email: "admin@example.com",
        password: "candidate password",
      }),
    ).rejects.toBe(hasherFailure);
  });
});

function createLogin(
  overrides: Partial<LoginOptions> = {},
): Login {
  return new Login({
    repository: new RecordingUserRepository(createAuthenticationRecord()),
    passwordHasher: new RecordingPasswordHasher(true),
    tokenService: new RecordingTokenService(),
    dummyPasswordHash,
    ...overrides,
  });
}

class RecordingPasswordHasher implements PasswordHasherPort {
  readonly verifications: Array<{
    password: NormalizedPassword;
    passwordHash: string;
  }> = [];

  constructor(
    private readonly passwordMatches: boolean,
    private readonly failure?: Error,
  ) {}

  async hash(): Promise<string> {
    throw new Error("Not used in this test");
  }

  async verify(
    password: NormalizedPassword,
    passwordHash: string,
  ): Promise<boolean> {
    this.verifications.push({ password, passwordHash });
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.passwordMatches;
  }
}

class RecordingUserRepository implements UserRepositoryPort {
  readonly lookedUpEmails: NormalizedUserEmail[] = [];

  constructor(
    private readonly authenticationRecord: UserAuthenticationRecord | null,
    private readonly lookupFailure?: Error,
  ) {}

  async createUser(_input: CreateUserInput): Promise<UserAccount> {
    throw new Error("Not used in this test");
  }

  async findById(): Promise<UserAccount | null> {
    throw new Error("Not used in this test");
  }

  async findByNormalizedEmail(
    normalizedEmail: NormalizedUserEmail,
  ): Promise<UserAuthenticationRecord | null> {
    this.lookedUpEmails.push(normalizedEmail);
    if (this.lookupFailure !== undefined) {
      throw this.lookupFailure;
    }
    return this.authenticationRecord;
  }
}

class RecordingTokenService implements TokenServicePort {
  readonly issuedInputs: IssueAccessTokenInput[] = [];

  async issue(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    this.issuedInputs.push(input);
    return {
      token: "issued-access-token",
      expiresAtEpochSeconds: 1_777_777_777,
    };
  }

  async verify(): Promise<VerifiedAccessToken> {
    throw new Error("Not used in this test");
  }
}

function createAuthenticationRecord(
  overrides: Partial<UserAuthenticationRecord> = {},
): UserAuthenticationRecord {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    normalizedEmail: "admin@example.com" as NormalizedUserEmail,
    passwordHash: storedPasswordHash,
    role: "admin",
    status: "active",
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-20T19:00:00.000Z",
    ...overrides,
  };
}
