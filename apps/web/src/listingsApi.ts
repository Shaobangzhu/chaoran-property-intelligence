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
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  status: string;
  listedDate: string;
  lastSeenDate: string;
  firstDiscoveredAt: string;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchListingsOptions {
  fetchImplementation?: FetchImplementation;
  signal?: AbortSignal;
}

export class SessionAuthenticationRequiredError extends Error {
  constructor() {
    super("Session authentication required");
    this.name = "SessionAuthenticationRequiredError";
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
    propertyType: readString(value, "propertyType"),
    bedrooms: readFiniteNumber(value, "bedrooms"),
    bathrooms: readFiniteNumber(value, "bathrooms"),
    price: readFiniteNumber(value, "price"),
    status: readString(value, "status"),
    listedDate: readString(value, "listedDate"),
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

function readSource(value: unknown): ListingSummary["source"] {
  if (value !== "rentcast" && value !== "manual") {
    throw invalidResponse();
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): Error {
  return new Error("Listings response was invalid");
}
