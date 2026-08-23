import {
  listingSearchCriteriaSchemaVersion,
  listingSearchState,
  listingSearchStatus,
  normalizeListingSearchCriteria,
  type ListingPropertyType,
  type ListingSearchCity,
} from "@chaoran-property-intelligence/domain";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";

export interface EditableListingSearchCriteria {
  propertyType: ListingPropertyType;
  minimumPrice: number;
  maximumPrice: number;
  minimumBedrooms: number;
  minimumBathrooms: number;
  cities: readonly ListingSearchCity[];
}

export interface ListingSearchCriteriaSnapshot {
  criteria: EditableListingSearchCriteria;
  revision: number;
  updatedAt: string;
}

export interface UpdateListingSearchCriteriaInput {
  expectedRevision: number;
  criteria: EditableListingSearchCriteria;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ListingSearchCriteriaRequestOptions {
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}

export class ListingSearchCriteriaValidationError extends Error {
  constructor() {
    super("Listing search criteria were invalid");
    this.name = "ListingSearchCriteriaValidationError";
  }
}

export class ListingSearchCriteriaChangedError extends Error {
  constructor() {
    super("Listing search criteria changed");
    this.name = "ListingSearchCriteriaChangedError";
  }
}

export async function fetchListingSearchCriteria(
  options: ListingSearchCriteriaRequestOptions = {},
): Promise<ListingSearchCriteriaSnapshot> {
  const response = await request("GET", options);
  throwForStatus(response, "load");
  return parseListingSearchCriteriaResponse(await readJson(response));
}

export async function updateListingSearchCriteria(
  input: UpdateListingSearchCriteriaInput,
  options: ListingSearchCriteriaRequestOptions = {},
): Promise<ListingSearchCriteriaSnapshot> {
  const normalizedInput = normalizeUpdateInput(input);
  const response = await request("PUT", options, normalizedInput);
  throwForStatus(response, "save");
  return parseListingSearchCriteriaResponse(await readJson(response));
}

async function request(
  method: "GET" | "PUT",
  options: ListingSearchCriteriaRequestOptions,
  body?: UpdateListingSearchCriteriaInput,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    credentials: "same-origin",
    headers,
    method,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }
  return (options.fetchImplementation ?? fetch)(
    "/api/listing-search-criteria",
    init,
  );
}

function throwForStatus(response: Response, operation: "load" | "save"): void {
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (response.status === 400) {
    throw new ListingSearchCriteriaValidationError();
  }
  if (response.status === 409) {
    throw new ListingSearchCriteriaChangedError();
  }
  if (!response.ok) {
    throw new Error(
      `Unable to ${operation} listing search criteria (${response.status})`,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

function parseListingSearchCriteriaResponse(
  value: unknown,
): ListingSearchCriteriaSnapshot {
  const response = strictRecord(value, ["searchCriteria"]);
  const snapshot = strictRecord(response.searchCriteria, [
    "criteria",
    "revision",
    "updatedAt",
  ]);
  const revision = snapshot.revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw invalidResponse();
  }

  return {
    criteria: normalizeEditableCriteria(snapshot.criteria),
    revision,
    updatedAt: readCanonicalTimestamp(snapshot.updatedAt),
  };
}

function normalizeUpdateInput(
  value: UpdateListingSearchCriteriaInput,
): UpdateListingSearchCriteriaInput {
  try {
    const input = strictRecord(value, ["criteria", "expectedRevision"]);
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new Error("Invalid revision");
    }

    return {
      expectedRevision: input.expectedRevision,
      criteria: normalizeEditableCriteria(input.criteria),
    };
  } catch {
    throw new ListingSearchCriteriaValidationError();
  }
}

function normalizeEditableCriteria(
  value: unknown,
): EditableListingSearchCriteria {
  const criteria = strictRecord(value, [
    "propertyType",
    "minimumPrice",
    "maximumPrice",
    "minimumBedrooms",
    "minimumBathrooms",
    "cities",
  ]);

  try {
    const normalized = normalizeListingSearchCriteria({
      schemaVersion: listingSearchCriteriaSchemaVersion,
      state: listingSearchState,
      status: listingSearchStatus,
      propertyType: criteria.propertyType,
      minimumPrice: criteria.minimumPrice,
      maximumPrice: criteria.maximumPrice,
      minimumBedrooms: criteria.minimumBedrooms,
      minimumBathrooms: criteria.minimumBathrooms,
      cities: criteria.cities,
    });
    return {
      propertyType: normalized.propertyType,
      minimumPrice: normalized.minimumPrice,
      maximumPrice: normalized.maximumPrice,
      minimumBedrooms: normalized.minimumBedrooms,
      minimumBathrooms: normalized.minimumBathrooms,
      cities: normalized.cities,
    };
  } catch {
    throw invalidResponse();
  }
}

function strictRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidResponse();
  }
  return record;
}

function readCanonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidResponse();
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw invalidResponse();
  }
  return value;
}

function invalidResponse(): Error {
  return new Error("Listing search criteria response was invalid");
}
