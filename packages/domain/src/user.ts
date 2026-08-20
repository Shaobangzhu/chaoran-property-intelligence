const maximumUserEmailLength = 254;
const userEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

declare const normalizedUserEmailBrand: unique symbol;

export type NormalizedUserEmail = string & {
  readonly [normalizedUserEmailBrand]: true;
};

export type UserRole = "admin";
export type UserStatus = "active" | "disabled";

export interface UserAccount {
  id: string;
  normalizedEmail: NormalizedUserEmail;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export class InvalidUserEmailError extends Error {
  constructor() {
    super("User email is invalid");
    this.name = "InvalidUserEmailError";
  }
}

export function normalizeUserEmail(email: string): NormalizedUserEmail {
  const normalizedEmail = email.trim().toLowerCase();

  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > maximumUserEmailLength ||
    !userEmailPattern.test(normalizedEmail)
  ) {
    throw new InvalidUserEmailError();
  }

  return normalizedEmail as NormalizedUserEmail;
}

export function isUserRole(value: unknown): value is UserRole {
  return value === "admin";
}

export function isUserStatus(value: unknown): value is UserStatus {
  return value === "active" || value === "disabled";
}
