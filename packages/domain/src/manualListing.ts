import type { ManualNormalizedListing } from "./normalizedListing.js";

const maximumPostgresInteger = 2_147_483_647;

export interface ManualListingDraftInput {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  price?: number | null;
  status: string;
  listedDate?: string | null;
  mlsName?: string | null;
  mlsNumber?: string | null;
  notes?: string | null;
}

export type ManualListingInputField =
  | keyof ManualListingDraftInput
  | "actorUserId";

export interface NormalizedManualListingDraft {
  listing: ManualNormalizedListing;
  notes: string | null;
}

export class InvalidManualListingError extends Error {
  constructor(readonly field: ManualListingInputField) {
    super("Manual listing input was invalid");
    this.name = "InvalidManualListingError";
  }
}

export function normalizeManualListingDraft(
  input: ManualListingDraftInput,
  now: Date,
): NormalizedManualListingDraft {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Manual listing clock was invalid");
  }

  const addressLine1 = normalizeRequiredString(
    input.addressLine1,
    "addressLine1",
    200,
  );
  const addressLine2 = normalizeOptionalString(
    input.addressLine2,
    "addressLine2",
    100,
  );
  const city = normalizeRequiredString(input.city, "city", 100);
  const state = normalizeRequiredString(input.state, "state", 2).toUpperCase();
  if (state !== "CA") {
    throw new InvalidManualListingError("state");
  }

  const zipCode = normalizeRequiredString(input.zipCode, "zipCode", 10);
  if (!/^\d{5}(?:-\d{4})?$/.test(zipCode)) {
    throw new InvalidManualListingError("zipCode");
  }

  const status = normalizeRequiredString(input.status, "status", 20);
  if (status !== "Active" && status !== "Pending") {
    throw new InvalidManualListingError("status");
  }

  const latitude = normalizeRequiredNumber(
    input.latitude,
    "latitude",
    -90,
    90,
  );
  const longitude = normalizeRequiredNumber(
    input.longitude,
    "longitude",
    -180,
    180,
  );
  const bedrooms = normalizeOptionalNumber(
    input.bedrooms,
    "bedrooms",
    0,
    100,
  );
  const bathrooms = normalizeOptionalNumber(
    input.bathrooms,
    "bathrooms",
    0,
    100,
  );
  const price = normalizeOptionalNumber(
    input.price,
    "price",
    0,
    maximumPostgresInteger,
    true,
  );
  const listedDate = normalizeOptionalDate(input.listedDate);
  const discoveredAt = now.toISOString();

  return {
    listing: {
      source: "manual",
      sourceListingId: null,
      mlsName: normalizeOptionalString(input.mlsName, "mlsName", 100),
      mlsNumber: normalizeOptionalString(input.mlsNumber, "mlsNumber", 100),
      formattedAddress: formatAddress({
        addressLine1,
        addressLine2,
        city,
        state,
        zipCode,
      }),
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      latitude,
      longitude,
      propertyType: normalizeOptionalString(
        input.propertyType,
        "propertyType",
        100,
      ),
      bedrooms,
      bathrooms,
      price,
      status,
      listedDate,
      lastSeenDate: discoveredAt.slice(0, 10),
      firstDiscoveredAt: discoveredAt,
    },
    notes: normalizeOptionalString(input.notes, "notes", 4000),
  };
}

function normalizeRequiredString(
  value: unknown,
  field: ManualListingInputField,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new InvalidManualListingError(field);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new InvalidManualListingError(field);
  }
  return normalized;
}

function normalizeOptionalString(
  value: unknown,
  field: ManualListingInputField,
  maximumLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InvalidManualListingError(field);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > maximumLength) {
    throw new InvalidManualListingError(field);
  }
  return normalized;
}

function normalizeRequiredNumber(
  value: unknown,
  field: ManualListingInputField,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new InvalidManualListingError(field);
  }
  return value;
}

function normalizeOptionalNumber(
  value: unknown,
  field: ManualListingInputField,
  minimum: number,
  maximum: number,
  integer = false,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = normalizeRequiredNumber(value, field, minimum, maximum);
  if (integer && !Number.isInteger(normalized)) {
    throw new InvalidManualListingError(field);
  }
  return normalized;
}

function normalizeOptionalDate(value: unknown): string | null {
  const normalized = normalizeOptionalString(value, "listedDate", 10);
  if (normalized === null) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (match === null) {
    throw new InvalidManualListingError("listedDate");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidManualListingError("listedDate");
  }
  return normalized;
}

function formatAddress(input: {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
}): string {
  const street =
    input.addressLine2 === null
      ? input.addressLine1
      : `${input.addressLine1} ${input.addressLine2}`;
  return `${street}, ${input.city}, ${input.state} ${input.zipCode}`;
}
