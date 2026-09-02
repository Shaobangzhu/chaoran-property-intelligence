export const priceDecisionModes = Object.freeze(["offer", "listing"] as const);
export type PriceDecisionMode = (typeof priceDecisionModes)[number];

export const priceDecisionState = "CA" as const;

export const PRICE_DECISION_ADDRESS_LIMITS = Object.freeze({
  streetAddress: 160,
  city: 100,
});

export interface PriceDecisionAddressInput {
  readonly streetAddress: string;
  readonly city: string;
  readonly zipCode: string;
}

export interface PriceDecisionAddress {
  readonly streetAddress: string;
  readonly city: string;
  readonly state: typeof priceDecisionState;
  readonly zipCode: string;
}

export type PriceDecisionAddressField =
  | keyof PriceDecisionAddressInput
  | "address";

export class InvalidPriceDecisionAddressError extends Error {
  constructor(readonly field: PriceDecisionAddressField) {
    super("Price Decision address was invalid");
    this.name = "InvalidPriceDecisionAddressError";
  }
}

export class InvalidPriceDecisionModeError extends Error {
  constructor() {
    super("Price Decision mode was invalid");
    this.name = "InvalidPriceDecisionModeError";
  }
}

const addressKeys = new Set(["streetAddress", "city", "zipCode"]);
const modeSet: ReadonlySet<unknown> = new Set(priceDecisionModes);

export function normalizePriceDecisionAddress(
  value: unknown,
): PriceDecisionAddress {
  if (!isExactRecord(value, addressKeys)) {
    throw new InvalidPriceDecisionAddressError("address");
  }

  const streetAddress = normalizeStreetAddress(value.streetAddress);
  const city = normalizeCity(value.city);
  const zipCode = normalizeZipCode(value.zipCode);

  return Object.freeze({
    streetAddress,
    city,
    state: priceDecisionState,
    zipCode,
  });
}

export function normalizePriceDecisionMode(value: unknown): PriceDecisionMode {
  if (!modeSet.has(value)) {
    throw new InvalidPriceDecisionModeError();
  }
  return value as PriceDecisionMode;
}

function normalizeStreetAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidPriceDecisionAddressError("streetAddress");
  }

  const normalized = normalizeDisplayText(value);
  if (
    hasControlCharacter(value) ||
    normalized.length < 3 ||
    normalized.length > PRICE_DECISION_ADDRESS_LIMITS.streetAddress ||
    normalized.includes(",") ||
    !/\p{N}/u.test(normalized) ||
    !/\p{L}/u.test(normalized)
  ) {
    throw new InvalidPriceDecisionAddressError("streetAddress");
  }
  return normalized;
}

function normalizeCity(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidPriceDecisionAddressError("city");
  }

  const normalized = normalizeDisplayText(value);
  if (
    hasControlCharacter(value) ||
    normalized.length < 2 ||
    normalized.length > PRICE_DECISION_ADDRESS_LIMITS.city ||
    !/^[\p{L}\p{M} .'-]+$/u.test(normalized)
  ) {
    throw new InvalidPriceDecisionAddressError("city");
  }
  return normalized;
}

function normalizeZipCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{5}$/.test(value)) {
    throw new InvalidPriceDecisionAddressError("zipCode");
  }
  return value;
}

function normalizeDisplayText(value: string): string {
  return value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
}
