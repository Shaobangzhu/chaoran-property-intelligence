import {
  InvalidUserEmailError,
  PasswordPolicyError,
  normalizePassword,
  normalizeUserEmail,
  type NormalizedUserEmail,
} from "@chaoran-property-intelligence/domain";

import {
  InvalidCredentialsError,
  toAuthenticatedUser,
  type AuthenticatedUser,
} from "./authentication.js";
import type { PasswordHasherPort } from "./passwordHasher.js";
import type { IssuedAccessToken, TokenServicePort } from "./tokenService.js";
import type { UserRepositoryPort } from "./userRepository.js";

export { InvalidCredentialsError } from "./authentication.js";

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: IssuedAccessToken;
}

export interface LoginOptions {
  repository: UserRepositoryPort;
  passwordHasher: PasswordHasherPort;
  tokenService: TokenServicePort;
  dummyPasswordHash: string;
}

export class Login {
  private readonly repository: UserRepositoryPort;
  private readonly passwordHasher: PasswordHasherPort;
  private readonly tokenService: TokenServicePort;
  private readonly dummyPasswordHash: string;

  constructor(options: LoginOptions) {
    this.repository = options.repository;
    this.passwordHasher = options.passwordHasher;
    this.tokenService = options.tokenService;
    this.dummyPasswordHash = options.dummyPasswordHash;
  }

  async execute(input: LoginInput): Promise<LoginResult> {
    let normalizedPassword;
    try {
      normalizedPassword = normalizePassword(input.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw new InvalidCredentialsError();
      }
      throw error;
    }

    const normalizedEmail = normalizeLoginEmail(input.email);
    const user =
      normalizedEmail === null
        ? null
        : await this.repository.findByNormalizedEmail(normalizedEmail);
    const passwordMatches = await this.passwordHasher.verify(
      normalizedPassword,
      user?.passwordHash ?? this.dummyPasswordHash,
    );

    if (user === null || !passwordMatches || user.status !== "active") {
      throw new InvalidCredentialsError();
    }

    const accessToken = await this.tokenService.issue({
      userId: user.id,
      role: user.role,
    });

    return {
      user: toAuthenticatedUser(user),
      accessToken,
    };
  }
}

function normalizeLoginEmail(email: string): NormalizedUserEmail | null {
  try {
    return normalizeUserEmail(email);
  } catch (error) {
    if (error instanceof InvalidUserEmailError) {
      return null;
    }
    throw error;
  }
}
