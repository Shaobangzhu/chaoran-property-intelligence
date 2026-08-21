import type { NormalizedUserEmail } from "./user.js";

const minimumPasswordLength = 15;
const maximumPasswordLength = 128;
const controlCharacterPattern = /\p{Cc}/u;

const blockedPasswords = new Set([
  "123456789012345",
  "administratoradmin",
  "chaoran property intelligence",
  "chaoran-property-intelligence",
  "correcthorsebatterystaple",
  "iloveyouiloveyou",
  "letmeinletmeinletmein",
  "passwordpassword",
  "qwertyuiopasdfgh",
  "welcome123456789",
]);

declare const normalizedPasswordBrand: unique symbol;

export type NormalizedPassword = string & {
  readonly [normalizedPasswordBrand]: true;
};

export type PasswordPolicyErrorReason =
  | "length"
  | "blocked"
  | "control-character";

export interface PasswordContext {
  normalizedEmail?: NormalizedUserEmail;
}

const passwordPolicyMessages: Record<PasswordPolicyErrorReason, string> = {
  length: "Password must contain between 15 and 128 characters",
  blocked: "Password is too common or context-specific",
  "control-character": "Password must not contain control characters",
};

export class PasswordPolicyError extends Error {
  constructor(readonly reason: PasswordPolicyErrorReason) {
    super(passwordPolicyMessages[reason]);
    this.name = "PasswordPolicyError";
  }
}

export function normalizePassword(password: string): NormalizedPassword {
  const normalizedPassword = password.normalize("NFC");
  const codePointLength = Array.from(normalizedPassword).length;

  if (
    codePointLength < minimumPasswordLength ||
    codePointLength > maximumPasswordLength
  ) {
    throw new PasswordPolicyError("length");
  }

  if (controlCharacterPattern.test(normalizedPassword)) {
    throw new PasswordPolicyError("control-character");
  }

  return normalizedPassword as NormalizedPassword;
}

export function validateNewPassword(
  password: string,
  context: PasswordContext = {},
): NormalizedPassword {
  const normalizedPassword = normalizePassword(password);

  const comparisonValue = normalizedPassword.toLowerCase();
  if (
    blockedPasswords.has(comparisonValue) ||
    createContextBlocklist(context).has(comparisonValue)
  ) {
    throw new PasswordPolicyError("blocked");
  }

  return normalizedPassword;
}

function createContextBlocklist(context: PasswordContext): Set<string> {
  if (context.normalizedEmail === undefined) {
    return new Set();
  }

  const email = context.normalizedEmail;
  const localPart = email.slice(0, email.indexOf("@"));

  return new Set([
    email,
    `${localPart}-administrator`,
    `${localPart} administrator`,
    `${localPart}1234567890`,
  ]);
}
