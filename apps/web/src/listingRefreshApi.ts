import { SessionAuthenticationRequiredError } from "./listingsApi.js";

export const listingRefreshStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
] as const;

export type ListingRefreshStatus = (typeof listingRefreshStatuses)[number];
export type ListingRefreshTriggerReason =
  | "criteria-change"
  | "scheduled"
  | "manual-retry";

export interface ListingRefreshSnapshot {
  runId: string;
  requestedRevision: number;
  effectiveRevision: number | null;
  triggerReason: ListingRefreshTriggerReason;
  status: ListingRefreshStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  selectedMarkets: readonly string[];
  selectedMarketCount: number;
  plannedProviderRequestCount: number;
  actualProviderRequestCount: number;
  returnedListingCount: number;
  publishedCurrentCount: number;
  failureCode: string | null;
  supersededByRunId: string | null;
}

export interface RetryListingRefreshInput {
  expectedRevision: number;
  confirmedPlannedProviderRequestCount: number;
}

export interface RetryListingRefreshResult {
  refresh: ListingRefreshSnapshot;
  refreshDispatch: "dispatched" | "failed";
}

export interface ListingRefreshRequestOptions {
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
}

export class ListingRefreshRetryUnavailableError extends Error {
  constructor() {
    super("Listing refresh retry is unavailable");
    this.name = "ListingRefreshRetryUnavailableError";
  }
}

export class ListingRefreshRetryRateLimitedError extends Error {
  constructor() {
    super("Listing refresh retry is rate limited");
    this.name = "ListingRefreshRetryRateLimitedError";
  }
}

export async function fetchLatestListingRefresh(
  options: ListingRefreshRequestOptions = {},
): Promise<ListingRefreshSnapshot | null> {
  const response = await request(
    "/api/listing-refresh/latest",
    { method: "GET" },
    options,
  );
  throwForStatus(response, "load");
  const body = strictRecord(await readJson(response), ["refresh"]);
  return body.refresh === null ? null : parseListingRefresh(body.refresh);
}

export async function retryLatestListingRefresh(
  input: RetryListingRefreshInput,
  options: ListingRefreshRequestOptions = {},
): Promise<RetryListingRefreshResult> {
  const normalized = normalizeRetryInput(input);
  const response = await request(
    "/api/listing-refresh/retry",
    {
      body: JSON.stringify(normalized),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    options,
  );
  throwForStatus(response, "retry");
  const body = strictRecord(await readJson(response), [
    "refresh",
    "refreshDispatch",
  ]);
  if (
    body.refreshDispatch !== "dispatched" &&
    body.refreshDispatch !== "failed"
  ) {
    throw invalidResponse();
  }
  return {
    refresh: parseListingRefresh(body.refresh),
    refreshDispatch: body.refreshDispatch,
  };
}

export function parseListingRefresh(value: unknown): ListingRefreshSnapshot {
  const run = strictRecord(value, [
    "runId",
    "requestedRevision",
    "effectiveRevision",
    "triggerReason",
    "status",
    "requestedAt",
    "startedAt",
    "completedAt",
    "selectedMarkets",
    "selectedMarketCount",
    "plannedProviderRequestCount",
    "actualProviderRequestCount",
    "returnedListingCount",
    "publishedCurrentCount",
    "failureCode",
    "supersededByRunId",
  ]);
  const status = readEnum(run.status, listingRefreshStatuses);
  const triggerReason = readEnum(run.triggerReason, [
    "criteria-change",
    "scheduled",
    "manual-retry",
  ] as const);
  const selectedMarkets = readStringArray(run.selectedMarkets);
  const parsed = {
    runId: readString(run.runId),
    requestedRevision: readPositiveInteger(run.requestedRevision),
    effectiveRevision: readNullablePositiveInteger(run.effectiveRevision),
    triggerReason,
    status,
    requestedAt: readTimestamp(run.requestedAt),
    startedAt: readNullableTimestamp(run.startedAt),
    completedAt: readNullableTimestamp(run.completedAt),
    selectedMarkets,
    selectedMarketCount: readNonnegativeInteger(run.selectedMarketCount),
    plannedProviderRequestCount: readNonnegativeInteger(
      run.plannedProviderRequestCount,
    ),
    actualProviderRequestCount: readNonnegativeInteger(
      run.actualProviderRequestCount,
    ),
    returnedListingCount: readNonnegativeInteger(run.returnedListingCount),
    publishedCurrentCount: readNonnegativeInteger(run.publishedCurrentCount),
    failureCode: readNullableString(run.failureCode),
    supersededByRunId: readNullableString(run.supersededByRunId),
  };
  if (
    parsed.selectedMarketCount !== selectedMarkets.length ||
    parsed.plannedProviderRequestCount !== selectedMarkets.length ||
    parsed.actualProviderRequestCount > parsed.plannedProviderRequestCount ||
    parsed.publishedCurrentCount > parsed.returnedListingCount
  ) {
    throw invalidResponse();
  }
  return parsed;
}

async function request(
  url: string,
  init: RequestInit,
  options: ListingRefreshRequestOptions,
): Promise<Response> {
  return (options.fetchImplementation ?? fetch)(url, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...init.headers },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function throwForStatus(
  response: Response,
  operation: "load" | "retry",
): void {
  if (response.status === 401) {
    throw new SessionAuthenticationRequiredError();
  }
  if (response.status === 409) {
    throw new ListingRefreshRetryUnavailableError();
  }
  if (response.status === 429) {
    throw new ListingRefreshRetryRateLimitedError();
  }
  if (!response.ok) {
    throw new Error(`Unable to ${operation} listing refresh (${response.status})`);
  }
}

function normalizeRetryInput(
  input: RetryListingRefreshInput,
): RetryListingRefreshInput {
  if (
    !isPositiveInteger(input.expectedRevision) ||
    !isPositiveInteger(input.confirmedPlannedProviderRequestCount) ||
    Object.keys(input).length !== 2
  ) {
    throw new Error("Listing refresh retry input was invalid");
  }
  return { ...input };
}

function strictRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw invalidResponse();
  }
  return record;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

function readString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidResponse();
  return value;
}

function readNullableString(value: unknown): string | null {
  return value === null ? null : readString(value);
}

function readStringArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw invalidResponse();
  }
  return [...value];
}

function readPositiveInteger(value: unknown): number {
  if (!isPositiveInteger(value)) throw invalidResponse();
  return value;
}

function readNullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : readPositiveInteger(value);
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

function readTimestamp(value: unknown): string {
  const timestamp = readString(value);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw invalidResponse();
  }
  return timestamp;
}

function readNullableTimestamp(value: unknown): string | null {
  return value === null ? null : readTimestamp(value);
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw invalidResponse();
  }
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalidResponse(): Error {
  return new Error("Listing refresh response was invalid");
}
