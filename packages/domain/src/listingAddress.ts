const LISTING_ADDRESS_KEY_PREFIX = "address:v1:";
const LISTING_ADDRESS_COMPONENT_COUNT = 5;

declare const listingAddressKeyBrand: unique symbol;

export type ListingAddressKey = string & {
  readonly [listingAddressKeyBrand]: true;
};

export interface ListingAddressInput {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zipCode: string;
}

export class InvalidListingAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListingAddressError";
  }
}

export function createListingAddressKey(value: unknown): ListingAddressKey {
  if (!isRecord(value)) {
    throw new InvalidListingAddressError("Listing address must be an object");
  }

  const components = [
    normalizeRequiredComponent(value.addressLine1, "addressLine1"),
    normalizeOptionalUnit(value.addressLine2),
    normalizeRequiredComponent(value.city, "city"),
    normalizeRequiredComponent(value.state, "state"),
    normalizeRequiredComponent(value.zipCode, "zipCode"),
  ];

  return `${LISTING_ADDRESS_KEY_PREFIX}${components
    .map((component) => encodeURIComponent(component))
    .join("|")}` as ListingAddressKey;
}

export function parseListingAddressKey(value: unknown): ListingAddressKey {
  if (
    typeof value !== "string" ||
    !value.startsWith(LISTING_ADDRESS_KEY_PREFIX)
  ) {
    throw new InvalidListingAddressError(
      `Listing address key must start with ${LISTING_ADDRESS_KEY_PREFIX}`,
    );
  }

  const encodedComponents = value
    .slice(LISTING_ADDRESS_KEY_PREFIX.length)
    .split("|");

  if (encodedComponents.length !== LISTING_ADDRESS_COMPONENT_COUNT) {
    throw new InvalidListingAddressError(
      `Listing address key must contain ${LISTING_ADDRESS_COMPONENT_COUNT} components`,
    );
  }

  let components: string[];
  try {
    components = encodedComponents.map((component) =>
      decodeURIComponent(component),
    );
  } catch {
    throw new InvalidListingAddressError(
      "Listing address key contains invalid encoding",
    );
  }

  const [addressLine1, addressLine2, city, state, zipCode] = components;
  const canonicalKey = createListingAddressKey({
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
  });

  if (canonicalKey !== value) {
    throw new InvalidListingAddressError(
      "Listing address key is not in canonical form",
    );
  }

  return canonicalKey;
}

export function isListingAddressKey(value: unknown): value is ListingAddressKey {
  try {
    parseListingAddressKey(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeRequiredComponent(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InvalidListingAddressError(`${field} must be a string`);
  }

  const normalized = normalizeComponent(value);
  if (normalized.length === 0) {
    throw new InvalidListingAddressError(`${field} cannot be blank`);
  }

  return normalized;
}

function normalizeOptionalUnit(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new InvalidListingAddressError(
      "addressLine2 must be a string, null, or undefined",
    );
  }

  return normalizeComponent(value);
}

function normalizeComponent(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
