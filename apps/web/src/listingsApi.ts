export interface ListingSummary {
  id: string;
  source: "rentcast" | "manual";
  sourceListingId: string | null;
  mlsName: string | null;
  mlsNumber: string | null;
  formattedAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  status: string;
  listedDate: string | null;
  lastSeenDate: string;
  firstDiscoveredAt: string;
}

export interface ManualListingDraft {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: "CA";
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  price?: number;
  status: "Active" | "Pending";
  listedDate?: string;
  mlsName?: string;
  mlsNumber?: string;
  notes?: string;
}

export type ManualListingField = keyof ManualListingDraft;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchListingsOptions {
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}

export interface CreateManualListingOptions {
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}

export class SessionAuthenticationRequiredError extends Error {
  constructor() {
    super("Session authentication required");
    this.name = "SessionAuthenticationRequiredError";
  }
}

export class ManualListingValidationError extends Error {
  constructor(readonly field: ManualListingField | null) {
    super("Manual listing input was invalid");
    this.name = "ManualListingValidationError";
  }
}

export async function fetchListings(
  options: FetchListingsOptions = {},
): Promise<ListingSummary[]> {
  const request: RequestInit = {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
  };
  if (options.signal !== undefined) {
    request.signal = options.signal;
  }

  const response = await (options.fetchImplementation ?? fetch)(
    "/api/listings",
    request,
  );
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (!response.ok) {
    throw new Error(`Unable to load listings (${response.status})`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse();
  }

  return parseListListingsResponse(body);
}

export async function createManualListing(
  draft: ManualListingDraft,
  options: CreateManualListingOptions = {},
): Promise<ListingSummary> {
  const request: RequestInit = {
    body: JSON.stringify(draft),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  };
  if (options.signal !== undefined) {
    request.signal = options.signal;
  }

  const response = await (options.fetchImplementation ?? fetch)(
    "/api/listings/manual",
    request,
  );
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (response.status === 400) {
    throw await parseManualListingValidationError(response);
  }
  if (!response.ok) {
    throw new Error(`Unable to create manual listing (${response.status})`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse();
  }
  if (!isRecord(body) || !("listing" in body)) {
    throw invalidResponse();
  }

  return parseListingSummary(body.listing);
}

async function parseManualListingValidationError(
  response: Response,
): Promise<ManualListingValidationError> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return new ManualListingValidationError(null);
    }
    if (
      body.code === "INVALID_MANUAL_LISTING" &&
      isManualListingField(body.field)
    ) {
      return new ManualListingValidationError(body.field);
    }
  } catch {
    // A malformed error response is intentionally reduced to a form-level error.
  }

  return new ManualListingValidationError(null);
}

function parseListListingsResponse(value: unknown): ListingSummary[] {
  if (!isRecord(value) || !Array.isArray(value.listings)) {
    throw invalidResponse();
  }

  return value.listings.map(parseListingSummary);
}

function parseListingSummary(value: unknown): ListingSummary {
  if (!isRecord(value)) {
    throw invalidResponse();
  }

  return {
    id: readString(value, "id"),
    source: readSource(value.source),
    sourceListingId: readNullableString(value, "sourceListingId"),
    mlsName: readNullableString(value, "mlsName"),
    mlsNumber: readNullableString(value, "mlsNumber"),
    formattedAddress: readString(value, "formattedAddress"),
    addressLine1: readString(value, "addressLine1"),
    addressLine2: readNullableString(value, "addressLine2"),
    city: readString(value, "city"),
    state: readString(value, "state"),
    zipCode: readString(value, "zipCode"),
    latitude: readFiniteNumber(value, "latitude"),
    longitude: readFiniteNumber(value, "longitude"),
    propertyType: readNullableString(value, "propertyType"),
    bedrooms: readNullableFiniteNumber(value, "bedrooms"),
    bathrooms: readNullableFiniteNumber(value, "bathrooms"),
    price: readNullableFiniteNumber(value, "price"),
    status: readString(value, "status"),
    listedDate: readNullableString(value, "listedDate"),
    lastSeenDate: readString(value, "lastSeenDate"),
    firstDiscoveredAt: readString(value, "firstDiscoveredAt"),
  };
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw invalidResponse();
  }

  return field;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  if (field !== null && typeof field !== "string") {
    throw invalidResponse();
  }

  return field;
}

function readFiniteNumber(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw invalidResponse();
  }

  return field;
}

function readNullableFiniteNumber(
  value: Record<string, unknown>,
  key: string,
): number | null {
  if (value[key] === null) {
    return null;
  }

  return readFiniteNumber(value, key);
}

function readSource(value: unknown): ListingSummary["source"] {
  if (value !== "rentcast" && value !== "manual") {
    throw invalidResponse();
  }

  return value;
}

function isManualListingField(value: unknown): value is ManualListingField {
  return (
    typeof value === "string" &&
    manualListingFields.has(value as ManualListingField)
  );
}

const manualListingFields = new Set<ManualListingField>([
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zipCode",
  "latitude",
  "longitude",
  "propertyType",
  "bedrooms",
  "bathrooms",
  "price",
  "status",
  "listedDate",
  "mlsName",
  "mlsNumber",
  "notes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): Error {
  return new Error("Listings response was invalid");
}
