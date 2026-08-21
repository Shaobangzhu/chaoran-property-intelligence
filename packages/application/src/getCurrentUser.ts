import {
  AuthenticationRequiredError,
  toAuthenticatedUser,
  type AuthenticatedUser,
} from "./authentication.js";
import {
  InvalidAccessTokenError,
  type TokenServicePort,
} from "./tokenService.js";
import type { UserRepositoryPort } from "./userRepository.js";

export { AuthenticationRequiredError } from "./authentication.js";

export interface GetCurrentUserInput {
  accessToken: string;
}

export interface GetCurrentUserOptions {
  repository: UserRepositoryPort;
  tokenService: TokenServicePort;
}

export class GetCurrentUser {
  private readonly repository: UserRepositoryPort;
  private readonly tokenService: TokenServicePort;

  constructor(options: GetCurrentUserOptions) {
    this.repository = options.repository;
    this.tokenService = options.tokenService;
  }

  async execute(input: GetCurrentUserInput): Promise<AuthenticatedUser> {
    let verifiedToken;
    try {
      verifiedToken = await this.tokenService.verify(input.accessToken);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new AuthenticationRequiredError();
      }
      throw error;
    }

    const user = await this.repository.findById(verifiedToken.userId);

    if (
      user === null ||
      user.status !== "active" ||
      user.role !== verifiedToken.role
    ) {
      throw new AuthenticationRequiredError();
    }

    return toAuthenticatedUser(user);
  }
}
