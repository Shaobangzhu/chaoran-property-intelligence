import { readRequiredVariable } from "./productionConfig.js";
import { formatRentCastAuditQuotaDisclosure } from "./rentCastAuditQuota.js";

const rentCastSaleListingsUrl = "https://api.rentcast.io/v1/listings/sale";
const expectedCity = "Stevenson Ranch";
const expectedState = "CA";
const expectedStatus = "Active";
const expectedZipCode = "91381";
const expectedPropertyType = "Single Family";
const maximumPrice = 850_000;
const minimumBedrooms = 4;
const minimumBathrooms = 2.5;
const resultLimit = 500;
const defaultTimeoutMs = 30_000;

export interface StevensonRanchCoverageAuditRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  timeoutMs?: number;
}

export interface StevensonRanchCoverageAuditSummary {
  cityCounts: Readonly<Record<string, number>>;
  coverageGatePassed: boolean;
  elapsedMilliseconds: number;
  expectedCityVerified: boolean;
  expectedZipCodeVerified: boolean;
  invalidFilterRows: number;
  propertyTypeCounts: Readonly<Record<string, number>>;
  responseBodyBytes: number;
  resultLimit: number;
  resultLimitMargin: number;
  returnedListings: number;
  returnedPageComplete: boolean;
  statusCounts: Readonly<Record<string, number>>;
  totalMatchingListings: number;
  zipCodeCounts: Readonly<Record<string, number>>;
}

interface AuditListing {
  bathrooms: number;
  bedrooms: number;
  city: string;
  price: number;
  propertyType: string;
  state: string;
  status: string;
  zipCode: string;
}

export async function runStevensonRanchCoverageAudit(
  runtime: StevensonRanchCoverageAuditRuntime,
): Promise<StevensonRanchCoverageAuditSummary> {
  const apiKey = readRequiredVariable(
    runtime.environment,
    "RENTCAST_API_KEY",
  );
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, runtime.timeoutMs ?? defaultTimeoutMs);
  const startedAt = runtime.now();

  let response: Response;
  try {
    response = await runtime.fetch(createCoverageAuditUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      signal: abortController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("RentCast Stevenson Ranch coverage audit timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMilliseconds = Math.max(0, runtime.now() - startedAt);

  if (!response.ok) {
    throw new Error(
      `RentCast Stevenson Ranch coverage audit failed with status ${response.status}`,
    );
  }

  const responseText = await readResponseText(response);
  const listings = parseAuditListings(responseText);
  const totalMatchingListings = readTotalCount(response);

  return summarizeCoverageAudit({
    elapsedMilliseconds,
    listings,
    responseBodyBytes: new TextEncoder().encode(responseText).byteLength,
    totalMatchingListings,
  });
}

export function formatStevensonRanchCoverageAuditSummary(
  summary: StevensonRanchCoverageAuditSummary,
): string {
  return [
    "RentCast Stevenson Ranch coverage audit completed.",
    "Request profile: stevenson-ranch-91381-coverage-audit",
    ...formatRentCastAuditQuotaDisclosure(1),
    `Coverage gate: ${summary.coverageGatePassed ? "PASS" : "FAIL"}`,
    `Total matching listings: ${summary.totalMatchingListings}`,
    `Returned listings: ${summary.returnedListings}`,
    `Result limit: ${summary.resultLimit}`,
    `Result limit margin: ${summary.resultLimitMargin}`,
    `Returned page complete: ${summary.returnedPageComplete ? "yes" : "no"}`,
    `Expected city verified: ${summary.expectedCityVerified ? "yes" : "no"}`,
    `Expected ZIP verified: ${summary.expectedZipCodeVerified ? "yes" : "no"}`,
    `Invalid filter rows: ${summary.invalidFilterRows}`,
    `Response body bytes: ${summary.responseBodyBytes}`,
    `Elapsed milliseconds: ${summary.elapsedMilliseconds}`,
    `City counts: ${JSON.stringify(summary.cityCounts)}`,
    `ZIP counts: ${JSON.stringify(summary.zipCodeCounts)}`,
    `Property-type counts: ${JSON.stringify(summary.propertyTypeCounts)}`,
    `Status counts: ${JSON.stringify(summary.statusCounts)}`,
    "Production request profile was not changed.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
}

function createCoverageAuditUrl(): URL {
  const url = new URL(rentCastSaleListingsUrl);
  url.searchParams.set("zipCode", expectedZipCode);
  url.searchParams.set("state", expectedState);
  url.searchParams.set("status", expectedStatus);
  url.searchParams.set("propertyType", expectedPropertyType);
  url.searchParams.set("price", `*:${maximumPrice}`);
  url.searchParams.set("bedrooms", `${minimumBedrooms}:`);
  url.searchParams.set("bathrooms", `${minimumBathrooms}:`);
  url.searchParams.set("limit", String(resultLimit));
  url.searchParams.set("includeTotalCount", "true");

  return url;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new Error(
      "RentCast Stevenson Ranch coverage response was not valid JSON",
    );
  }
}

function parseAuditListings(responseText: string): AuditListing[] {
  let body: unknown;
  try {
    body = JSON.parse(responseText) as unknown;
  } catch {
    throw new Error(
      "RentCast Stevenson Ranch coverage response was not valid JSON",
    );
  }

  if (!Array.isArray(body)) {
    throwInvalidSchemaError();
  }

  return body.map(parseAuditListing);
}

function parseAuditListing(value: unknown): AuditListing {
  if (!isRecord(value)) {
    throwInvalidSchemaError();
  }

  return {
    bathrooms: readFiniteNumber(value, "bathrooms"),
    bedrooms: readFiniteNumber(value, "bedrooms"),
    city: readString(value, "city"),
    price: readFiniteNumber(value, "price"),
    propertyType: readString(value, "propertyType"),
    state: readString(value, "state"),
    status: readString(value, "status"),
    zipCode: readString(value, "zipCode"),
  };
}

function readTotalCount(response: Response): number {
  const value = response.headers.get("X-Total-Count");
  if (value === null || !/^\d+$/.test(value)) {
    throw new Error(
      "RentCast Stevenson Ranch coverage response did not include a valid X-Total-Count header",
    );
  }

  const totalCount = Number(value);
  if (!Number.isSafeInteger(totalCount)) {
    throw new Error(
      "RentCast Stevenson Ranch coverage response did not include a valid X-Total-Count header",
    );
  }

  return totalCount;
}

function summarizeCoverageAudit(input: {
  elapsedMilliseconds: number;
  listings: AuditListing[];
  responseBodyBytes: number;
  totalMatchingListings: number;
}): StevensonRanchCoverageAuditSummary {
  const cityCounts = countBy(input.listings, (listing) => listing.city);
  const zipCodeCounts = countBy(
    input.listings,
    (listing) => listing.zipCode,
  );
  const propertyTypeCounts = countBy(
    input.listings,
    (listing) => listing.propertyType,
  );
  const statusCounts = countBy(
    input.listings,
    (listing) => listing.status,
  );
  const returnedListings = input.listings.length;
  const expectedCityVerified =
    returnedListings > 0 &&
    input.listings.every((listing) => listing.city === expectedCity);
  const expectedZipCodeVerified =
    returnedListings > 0 &&
    input.listings.every((listing) => listing.zipCode === expectedZipCode);
  const invalidFilterRows = input.listings.filter(
    (listing) =>
      listing.state !== expectedState ||
      listing.status !== expectedStatus ||
      listing.propertyType !== expectedPropertyType ||
      listing.price > maximumPrice ||
      listing.bedrooms < minimumBedrooms ||
      listing.bathrooms < minimumBathrooms,
  ).length;
  const returnedPageComplete =
    returnedListings === input.totalMatchingListings;
  const resultLimitMargin = Math.max(
    0,
    resultLimit - input.totalMatchingListings,
  );
  const coverageGatePassed =
    input.totalMatchingListings < resultLimit &&
    returnedPageComplete &&
    expectedCityVerified &&
    expectedZipCodeVerified &&
    invalidFilterRows === 0;

  return Object.freeze({
    cityCounts,
    coverageGatePassed,
    elapsedMilliseconds: input.elapsedMilliseconds,
    expectedCityVerified,
    expectedZipCodeVerified,
    invalidFilterRows,
    propertyTypeCounts,
    responseBodyBytes: input.responseBodyBytes,
    resultLimit,
    resultLimitMargin,
    returnedListings,
    returnedPageComplete,
    statusCounts,
    totalMatchingListings: input.totalMatchingListings,
    zipCodeCounts,
  });
}

function countBy(
  listings: readonly AuditListing[],
  selectValue: (listing: AuditListing) => string,
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();

  for (const listing of listings) {
    const value = selectValue(listing);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throwInvalidSchemaError();
  }

  return value;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalidSchemaError();
  }

  return value;
}

function throwInvalidSchemaError(): never {
  throw new Error(
    "RentCast Stevenson Ranch coverage response did not match the expected audit schema",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
