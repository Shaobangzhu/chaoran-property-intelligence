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

export type ListingLifecycleState =
  | "current"
  | "out_of_scope"
  | "missing"
  | "inactive"
  | "sold";

export interface ListingLifecycleSummary {
  state: ListingLifecycleState;
  appliedRevision: number;
  firstMatchedAt: string;
  lastMatchedAt: string;
  lastServerObservedAt: string;
  consecutiveCompleteRunAbsenceCount: number;
  inactiveAt: string | null;
  explicitProviderStatus: "sold" | null;
  explicitProviderStatusObservedAt: string | null;
}

export interface InventoryListingSummary extends ListingSummary {
  lifecycle: ListingLifecycleSummary;
  acquisitionEligible: boolean;
  currentDisplayEligible: boolean;
}

export interface CurrentListingInventorySnapshot {
  appliedRevision: number;
  refreshedAt: string;
  listings: InventoryListingSummary[];
}

export interface ListingHistoryPageSnapshot {
  listings: InventoryListingSummary[];
  nextCursor: string | null;
}

export interface ListingHistoryRequest {
  lifecycleStates: readonly Exclude<ListingLifecycleState, "current">[];
  cursor: string | null;
  limit: number;
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

export type ManualListingPatch = Partial<{
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: "CA";
  zipCode: string;
  latitude: number;
  longitude: number;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  status: "Active" | "Pending";
  listedDate: string | null;
  mlsName: string | null;
  mlsNumber: string | null;
  notes: string | null;
}>;

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

export type MutateManualListingOptions = CreateManualListingOptions;

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

export class ManualListingNotFoundError extends Error {
  constructor() {
    super("Manual listing was not found");
    this.name = "ManualListingNotFoundError";
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

export async function fetchCurrentListingInventory(
  options: FetchListingsOptions = {},
): Promise<CurrentListingInventorySnapshot | null> {
  const response = await getJson("/api/listings/current", options);
  const body = await readResponseJson(response);
  if (!isExactRecord(body, ["current"])) throw invalidResponse();
  if (body.current === null) return null;
  if (
    !isExactRecord(body.current, [
      "appliedRevision",
      "refreshedAt",
      "listings",
    ])
  ) {
    throw invalidResponse();
  }
  if (!Array.isArray(body.current.listings)) throw invalidResponse();
  const appliedRevision = readPositiveInteger(body.current.appliedRevision);
  const listings = body.current.listings.map(parseInventoryListingSummary);
  if (
    listings.some(
      (listing) =>
        listing.lifecycle.state !== "current" ||
        listing.lifecycle.appliedRevision !== appliedRevision ||
        !listing.currentDisplayEligible,
    )
  ) {
    throw invalidResponse();
  }
  return {
    appliedRevision,
    refreshedAt: readCanonicalTimestamp(body.current.refreshedAt),
    listings,
  };
}

export async function fetchListingHistory(
  query: ListingHistoryRequest,
  options: FetchListingsOptions = {},
): Promise<ListingHistoryPageSnapshot> {
  const normalized = normalizeHistoryRequest(query);
  const parameters = new URLSearchParams({
    lifecycleStates: normalized.lifecycleStates.join(","),
    limit: String(normalized.limit),
  });
  if (normalized.cursor !== null) parameters.set("cursor", normalized.cursor);
  const response = await getJson(
    `/api/listings/history?${parameters.toString()}`,
    options,
  );
  const body = await readResponseJson(response);
  if (!isExactRecord(body, ["history"])) throw invalidResponse();
  if (!isExactRecord(body.history, ["listings", "nextCursor"])) {
    throw invalidResponse();
  }
  if (
    !Array.isArray(body.history.listings) ||
    (body.history.nextCursor !== null &&
      (typeof body.history.nextCursor !== "string" ||
        body.history.nextCursor.length === 0))
  ) {
    throw invalidResponse();
  }
  const listings = body.history.listings.map(parseInventoryListingSummary);
  if (listings.some((listing) => listing.lifecycle.state === "current")) {
    throw invalidResponse();
  }
  return {
    listings,
    nextCursor: body.history.nextCursor,
  };
}

async function getJson(
  url: string,
  options: FetchListingsOptions,
): Promise<Response> {
  const request: RequestInit = {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const response = await (options.fetchImplementation ?? fetch)(url, request);
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (!response.ok) {
    throw new Error(`Unable to load listing inventory (${response.status})`);
  }
  return response;
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
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

export async function updateManualListing(
  listingId: string,
  patch: ManualListingPatch,
  options: MutateManualListingOptions = {},
): Promise<ListingSummary> {
  const request: RequestInit = {
    body: JSON.stringify(patch),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "PATCH",
  };
  if (options.signal !== undefined) {
    request.signal = options.signal;
  }

  const response = await (options.fetchImplementation ?? fetch)(
    `/api/listings/${encodeURIComponent(listingId)}`,
    request,
  );
  if (response.status === 400) {
    throw await parseManualListingValidationError(response);
  }
  throwForManualListingMutation(response, "update");
  if (response.status !== 200) {
    throw new Error(`Unable to update manual listing (${response.status})`);
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

export async function archiveManualListing(
  listingId: string,
  options: MutateManualListingOptions = {},
): Promise<void> {
  const request: RequestInit = {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "POST",
  };
  if (options.signal !== undefined) {
    request.signal = options.signal;
  }

  const response = await (options.fetchImplementation ?? fetch)(
    `/api/listings/${encodeURIComponent(listingId)}/archive`,
    request,
  );
  throwForManualListingMutation(response, "archive");
  if (response.status !== 204) {
    throw new Error(`Unable to archive manual listing (${response.status})`);
  }
}

function throwForManualListingMutation(
  response: Response,
  operation: "update" | "archive",
): void {
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (response.status === 404) {
    throw new ManualListingNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`Unable to ${operation} manual listing (${response.status})`);
  }
}

async function parseManualListingValidationError(
  response: Response,
): Promise<ManualListingValidationError> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.error)) {
      return new ManualListingValidationError(null);
    }
    if (
      body.error.code === "INVALID_MANUAL_LISTING" &&
      isManualListingField(body.error.field)
    ) {
      return new ManualListingValidationError(body.error.field);
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

function parseInventoryListingSummary(
  value: unknown,
): InventoryListingSummary {
  if (!isRecord(value)) throw invalidResponse();
  const lifecycle = value.lifecycle;
  if (
    !isExactRecord(lifecycle, [
      "state",
      "appliedRevision",
      "firstMatchedAt",
      "lastMatchedAt",
      "lastServerObservedAt",
      "consecutiveCompleteRunAbsenceCount",
      "inactiveAt",
      "explicitProviderStatus",
      "explicitProviderStatusObservedAt",
    ]) ||
    typeof value.acquisitionEligible !== "boolean" ||
    typeof value.currentDisplayEligible !== "boolean"
  ) {
    throw invalidResponse();
  }
  const state = readLifecycleState(lifecycle.state);
  if (
    lifecycle.explicitProviderStatus !== null &&
    lifecycle.explicitProviderStatus !== "sold"
  ) {
    throw invalidResponse();
  }
  return {
    ...parseListingSummary(value),
    lifecycle: {
      state,
      appliedRevision: readPositiveInteger(lifecycle.appliedRevision),
      firstMatchedAt: readCanonicalTimestamp(lifecycle.firstMatchedAt),
      lastMatchedAt: readCanonicalTimestamp(lifecycle.lastMatchedAt),
      lastServerObservedAt: readCanonicalTimestamp(
        lifecycle.lastServerObservedAt,
      ),
      consecutiveCompleteRunAbsenceCount: readNonnegativeInteger(
        lifecycle.consecutiveCompleteRunAbsenceCount,
      ),
      inactiveAt: readNullableCanonicalTimestamp(lifecycle.inactiveAt),
      explicitProviderStatus: lifecycle.explicitProviderStatus,
      explicitProviderStatusObservedAt: readNullableCanonicalTimestamp(
        lifecycle.explicitProviderStatusObservedAt,
      ),
    },
    acquisitionEligible: value.acquisitionEligible,
    currentDisplayEligible: value.currentDisplayEligible,
  };
}

function normalizeHistoryRequest(
  query: ListingHistoryRequest,
): ListingHistoryRequest {
  if (
    !Array.isArray(query.lifecycleStates) ||
    query.lifecycleStates.length === 0 ||
    new Set(query.lifecycleStates).size !== query.lifecycleStates.length ||
    query.lifecycleStates.some(
      (state) =>
        state !== "out_of_scope" &&
        state !== "missing" &&
        state !== "inactive" &&
        state !== "sold",
    ) ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    (query.cursor !== null &&
      (typeof query.cursor !== "string" ||
        query.cursor.length === 0 ||
        query.cursor.length > 512))
  ) {
    throw new Error("Listing history request was invalid");
  }
  return {
    lifecycleStates: [...query.lifecycleStates],
    cursor: query.cursor,
    limit: query.limit,
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

function readLifecycleState(value: unknown): ListingLifecycleState {
  if (
    value !== "current" &&
    value !== "out_of_scope" &&
    value !== "missing" &&
    value !== "inactive" &&
    value !== "sold"
  ) {
    throw invalidResponse();
  }
  return value;
}

function readPositiveInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw invalidResponse();
  }
  return value;
}

function readNonnegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw invalidResponse();
  }
  return value;
}

function readCanonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw invalidResponse();
  }
  return value;
}

function readNullableCanonicalTimestamp(value: unknown): string | null {
  return value === null ? null : readCanonicalTimestamp(value);
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

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidResponse(): Error {
  return new Error("Listings response was invalid");
}
