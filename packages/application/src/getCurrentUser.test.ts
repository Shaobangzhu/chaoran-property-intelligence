import { describe, expect, it } from "vitest";

import type {
  NormalizedUserEmail,
  UserAccount,
} from "@chaoran-property-intelligence/domain";

import {
  AuthenticationRequiredError,
  GetCurrentUser,
} from "./getCurrentUser.js";
import {
  InvalidAccessTokenError,
  type IssuedAccessToken,
  type IssueAccessTokenInput,
  type TokenServicePort,
  type VerifiedAccessToken,
} from "./tokenService.js";
import type {
  CreateUserInput,
  UserAuthenticationRecord,
  UserRepositoryPort,
} from "./userRepository.js";

const userId = "0198c7d2-7668-7775-b0fc-b789690a60c1";

describe("GetCurrentUser", () => {
  it("verifies the candidate token and returns the current database identity", async () => {
    const repository = new IdUserRepository(createUser());
    const tokenService = new VerifyingTokenService(createVerifiedToken());
    const getCurrentUser = new GetCurrentUser({ repository, tokenService });

    const user = await getCurrentUser.execute({ accessToken: "candidate-token" });

    expect(tokenService.verifiedTokens).toEqual(["candidate-token"]);
    expect(repository.lookedUpIds).toEqual([userId]);
    expect(user).toEqual({
      id: userId,
      normalizedEmail: "current-admin@example.com",
      role: "admin",
    });
  });

  it.each([
    ["missing user", null, createVerifiedToken()],
    ["disabled user", createUser({ status: "disabled" }), createVerifiedToken()],
    [
      "role mismatch",
      createUser(),
      createVerifiedToken({ role: "viewer" as "admin" }),
    ],
  ])("rejects a %s with the same authentication failure", async (_label, user, token) => {
    const getCurrentUser = new GetCurrentUser({
      repository: new IdUserRepository(user),
      tokenService: new VerifyingTokenService(token),
    });

    await expect(
      getCurrentUser.execute({ accessToken: "candidate-token" }),
    ).rejects.toEqual(new AuthenticationRequiredError());
  });

  it("maps invalid access tokens to the bounded authentication failure", async () => {
    const tokenService = new VerifyingTokenService(
      createVerifiedToken(),
      new InvalidAccessTokenError(),
    );
    const repository = new IdUserRepository(createUser());
    const getCurrentUser = new GetCurrentUser({ repository, tokenService });

    await expect(
      getCurrentUser.execute({ accessToken: "invalid-token" }),
    ).rejects.toEqual(new AuthenticationRequiredError());
    expect(repository.lookedUpIds).toEqual([]);
  });

  it("does not hide unexpected token-service or repository failures", async () => {
    const tokenFailure = new Error("token service unavailable");
    const firstUseCase = new GetCurrentUser({
      repository: new IdUserRepository(createUser()),
      tokenService: new VerifyingTokenService(createVerifiedToken(), tokenFailure),
    });

    await expect(
      firstUseCase.execute({ accessToken: "candidate-token" }),
    ).rejects.toBe(tokenFailure);

    const repositoryFailure = new Error("database unavailable");
    const secondUseCase = new GetCurrentUser({
      repository: new IdUserRepository(createUser(), repositoryFailure),
      tokenService: new VerifyingTokenService(createVerifiedToken()),
    });

    await expect(
      secondUseCase.execute({ accessToken: "candidate-token" }),
    ).rejects.toBe(repositoryFailure);
  });
});

class IdUserRepository implements UserRepositoryPort {
  readonly lookedUpIds: string[] = [];

  constructor(
    private readonly user: UserAccount | null,
    private readonly lookupFailure?: Error,
  ) {}

  async createUser(_input: CreateUserInput): Promise<UserAccount> {
    throw new Error("Not used in this test");
  }

  async findById(id: string): Promise<UserAccount | null> {
    this.lookedUpIds.push(id);
    if (this.lookupFailure !== undefined) {
      throw this.lookupFailure;
    }
    return this.user;
  }

  async findByNormalizedEmail(): Promise<UserAuthenticationRecord | null> {
    throw new Error("Not used in this test");
  }
}

class VerifyingTokenService implements TokenServicePort {
  readonly verifiedTokens: string[] = [];

  constructor(
    private readonly verifiedToken: VerifiedAccessToken,
    private readonly verificationFailure?: Error,
  ) {}

  async issue(_input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    throw new Error("Not used in this test");
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    this.verifiedTokens.push(token);
    if (this.verificationFailure !== undefined) {
      throw this.verificationFailure;
    }
    return this.verifiedToken;
  }
}

function createUser(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: userId,
    normalizedEmail: "current-admin@example.com" as NormalizedUserEmail,
    role: "admin",
    status: "active",
    createdAt: "2026-08-20T19:00:00.000Z",
    updatedAt: "2026-08-20T19:00:00.000Z",
    ...overrides,
  };
}

function createVerifiedToken(
  overrides: Partial<VerifiedAccessToken> = {},
): VerifiedAccessToken {
  return {
    userId,
    role: "admin",
    tokenId: "0198c7d2-7668-7775-b0fc-b789690a60c2",
    issuedAtEpochSeconds: 1_777_770_000,
    expiresAtEpochSeconds: 1_777_773_600,
    ...overrides,
  };
}
