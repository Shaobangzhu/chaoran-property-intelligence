import type {
  ManualListingDraftInput,
  ManualListingRecord,
} from "@chaoran-property-intelligence/application";

import {
  type ListingSummaryDto,
  toListingSummaryDto,
} from "./listingDto.js";

const requiredFields = [
  "addressLine1",
  "city",
  "state",
  "zipCode",
  "latitude",
  "longitude",
  "status",
] as const;

const optionalStringFields = [
  "addressLine2",
  "propertyType",
  "listedDate",
  "mlsName",
  "mlsNumber",
  "notes",
] as const;

const optionalNumberFields = [
  "bedrooms",
  "bathrooms",
  "price",
] as const;

const allowedFields = new Set<string>([
  ...requiredFields,
  ...optionalStringFields,
  ...optionalNumberFields,
]);

export interface CreateManualListingResponse {
  listing: ListingSummaryDto;
}

export class InvalidManualListingRequestError extends Error {
  constructor() {
    super("Manual listing request body was invalid");
    this.name = "InvalidManualListingRequestError";
  }
}

export function parseManualListingDraftDto(
  value: unknown,
): ManualListingDraftInput {
  if (!isRecord(value)) {
    throw new InvalidManualListingRequestError();
  }

  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowedFields.has(key)) ||
    requiredFields.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new InvalidManualListingRequestError();
  }

  const draft: ManualListingDraftInput = {
    addressLine1: readString(value, "addressLine1"),
    city: readString(value, "city"),
    state: readString(value, "state"),
    zipCode: readString(value, "zipCode"),
    latitude: readNumber(value, "latitude"),
    longitude: readNumber(value, "longitude"),
    status: readString(value, "status"),
  };

  for (const field of optionalStringFields) {
    copyOptionalValue(draft, value, field, "string");
  }
  for (const field of optionalNumberFields) {
    copyOptionalValue(draft, value, field, "number");
  }

  return draft;
}

export function toCreateManualListingResponse(
  record: ManualListingRecord,
): CreateManualListingResponse {
  return {
    listing: toListingSummaryDto({
      id: record.id,
      listing: record.listing,
    }),
  };
}

function copyOptionalValue(
  output: ManualListingDraftInput,
  input: Record<string, unknown>,
  field:
    | (typeof optionalStringFields)[number]
    | (typeof optionalNumberFields)[number],
  expectedType: "string" | "number",
): void {
  if (!Object.hasOwn(input, field)) {
    return;
  }

  const value = input[field];
  if (value !== null && typeof value !== expectedType) {
    throw new InvalidManualListingRequestError();
  }

  (output as unknown as Record<string, unknown>)[field] = value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new InvalidManualListingRequestError();
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new InvalidManualListingRequestError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
