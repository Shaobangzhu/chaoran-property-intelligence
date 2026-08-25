import { readRequiredVariable } from "./productionConfig.js";
import { formatRentCastAuditQuotaDisclosure } from "./rentCastAuditQuota.js";

const rentCastSaleListingsUrl = "https://api.rentcast.io/v1/listings/sale";
const expectedCity = "Irvine";
const expectedState = "CA";
const expectedStatus = "Active";
const resultLimit = 500;
const defaultTimeoutMs = 30_000;

export interface IrvineProviderIdentityProbeRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  timeoutMs?: number;
}

export interface IrvineProviderIdentityProbeSummary {
  allMatchingRowsReturned: boolean;
  cityCounts: Readonly<Record<string, number>>;
  elapsedMilliseconds: number;
  expectedCityVerified: boolean;
  identityGatePassed: boolean;
  invalidScopeRows: number;
  responseBodyBytes: number;
  resultLimit: number;
  returnedIdentityRows: number;
  returnedSampleComplete: boolean;
  sampleLimitSaturated: boolean;
  totalMatchingActiveListings: number;
}

interface IdentityListing {
  city: string;
  state: string;
  status: string;
}

export async function runIrvineProviderIdentityProbe(
  runtime: IrvineProviderIdentityProbeRuntime,
): Promise<IrvineProviderIdentityProbeSummary> {
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
    response = await runtime.fetch(createIdentityProbeUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      signal: abortController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("RentCast Irvine provider identity probe timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMilliseconds = Math.max(0, runtime.now() - startedAt);

  if (!response.ok) {
    throw new Error(
      `RentCast Irvine provider identity probe failed with status ${response.status}`,
    );
  }

  const responseText = await readResponseText(response);
  const listings = parseIdentityListings(responseText);
  const totalMatchingActiveListings = readTotalCount(response);

  return summarizeIdentityProbe({
    elapsedMilliseconds,
    listings,
    responseBodyBytes: new TextEncoder().encode(responseText).byteLength,
    totalMatchingActiveListings,
  });
}

export function formatIrvineProviderIdentityProbeSummary(
  summary: IrvineProviderIdentityProbeSummary,
): string {
  return [
    "RentCast Irvine provider identity probe completed.",
    "Request profile: irvine-ca-active-market-identity-probe",
    ...formatRentCastAuditQuotaDisclosure(1),
    `Identity gate: ${summary.identityGatePassed ? "PASS" : "FAIL"}`,
    `Expected city verified: ${summary.expectedCityVerified ? "yes" : "no"}`,
    `Total matching active listings: ${summary.totalMatchingActiveListings}`,
    `Returned identity rows: ${summary.returnedIdentityRows}`,
    `Result limit: ${summary.resultLimit}`,
    `Returned sample complete: ${summary.returnedSampleComplete ? "yes" : "no"}`,
    `Sample limit saturated: ${summary.sampleLimitSaturated ? "yes" : "no"}`,
    `All matching rows returned: ${summary.allMatchingRowsReturned ? "yes" : "no"}`,
    `Invalid scope rows: ${summary.invalidScopeRows}`,
    `Provider city counts: ${JSON.stringify(summary.cityCounts)}`,
    `Response body bytes: ${summary.responseBodyBytes}`,
    `Elapsed milliseconds: ${summary.elapsedMilliseconds}`,
    "Geography evidence only; product inventory completeness was not asserted.",
    "Production filters and request profile were not changed.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
}

function createIdentityProbeUrl(): URL {
  const url = new URL(rentCastSaleListingsUrl);
  url.searchParams.set("city", expectedCity);
  url.searchParams.set("state", expectedState);
  url.searchParams.set("status", expectedStatus);
  url.searchParams.set("limit", String(resultLimit));
  url.searchParams.set("includeTotalCount", "true");

  return url;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throwInvalidSchemaError();
  }
}

function parseIdentityListings(responseText: string): IdentityListing[] {
  let body: unknown;
  try {
    body = JSON.parse(responseText) as unknown;
  } catch {
    throwInvalidSchemaError();
  }

  if (!Array.isArray(body)) {
    throwInvalidSchemaError();
  }

  return body.map(parseIdentityListing);
}

function parseIdentityListing(value: unknown): IdentityListing {
  if (!isRecord(value)) {
    throwInvalidSchemaError();
  }

  return {
    city: readString(value, "city"),
    state: readString(value, "state"),
    status: readString(value, "status"),
  };
}

function readTotalCount(response: Response): number {
  const value = response.headers.get("X-Total-Count");
  if (value === null || !/^\d+$/.test(value)) {
    throwInvalidTotalCountError();
  }

  const totalCount = Number(value);
  if (!Number.isSafeInteger(totalCount)) {
    throwInvalidTotalCountError();
  }

  return totalCount;
}

function summarizeIdentityProbe(input: {
  elapsedMilliseconds: number;
  listings: readonly IdentityListing[];
  responseBodyBytes: number;
  totalMatchingActiveListings: number;
}): IrvineProviderIdentityProbeSummary {
  const cityCounts = countBy(input.listings, (listing) => listing.city);
  const returnedIdentityRows = input.listings.length;
  const expectedCityVerified =
    returnedIdentityRows > 0 &&
    input.listings.every((listing) => listing.city === expectedCity);
  const invalidScopeRows = input.listings.filter(
    (listing) =>
      listing.state !== expectedState || listing.status !== expectedStatus,
  ).length;
  const expectedSampleRows = Math.min(
    input.totalMatchingActiveListings,
    resultLimit,
  );
  const returnedSampleComplete =
    returnedIdentityRows === expectedSampleRows;
  const allMatchingRowsReturned =
    returnedIdentityRows === input.totalMatchingActiveListings;
  const sampleLimitSaturated =
    input.totalMatchingActiveListings >= resultLimit;

  return Object.freeze({
    allMatchingRowsReturned,
    cityCounts,
    elapsedMilliseconds: input.elapsedMilliseconds,
    expectedCityVerified,
    identityGatePassed:
      expectedCityVerified &&
      invalidScopeRows === 0 &&
      returnedSampleComplete,
    invalidScopeRows,
    responseBodyBytes: input.responseBodyBytes,
    resultLimit,
    returnedIdentityRows,
    returnedSampleComplete,
    sampleLimitSaturated,
    totalMatchingActiveListings: input.totalMatchingActiveListings,
  });
}

function countBy(
  listings: readonly IdentityListing[],
  selectValue: (listing: IdentityListing) => string,
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

function throwInvalidSchemaError(): never {
  throw new Error(
    "RentCast Irvine provider identity response did not match the expected probe schema",
  );
}

function throwInvalidTotalCountError(): never {
  throw new Error(
    "RentCast Irvine provider identity response did not include a valid X-Total-Count header",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
