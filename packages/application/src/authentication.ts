import type {
  NormalizedUserEmail,
  UserAccount,
  UserRole,
} from "@chaoran-property-intelligence/domain";

export interface AuthenticatedUser {
  id: string;
  normalizedEmail: NormalizedUserEmail;
  role: UserRole;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationRequiredError";
  }
}

export function toAuthenticatedUser(user: UserAccount): AuthenticatedUser {
  return {
    id: user.id,
    normalizedEmail: user.normalizedEmail,
    role: user.role,
  };
}
