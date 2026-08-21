import type { UserRole } from "@chaoran-property-intelligence/domain";

export interface IssueAccessTokenInput {
  userId: string;
  role: UserRole;
}

export interface IssuedAccessToken {
  token: string;
  expiresAtEpochSeconds: number;
}

export interface VerifiedAccessToken {
  userId: string;
  role: UserRole;
  tokenId: string;
  issuedAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
}

export interface TokenServicePort {
  issue(input: IssueAccessTokenInput): Promise<IssuedAccessToken>;
  verify(token: string): Promise<VerifiedAccessToken>;
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super("Access token is invalid");
    this.name = "InvalidAccessTokenError";
  }
}
