import { readRequiredVariable } from "./productionConfig.js";
import { formatRentCastAuditQuotaDisclosure } from "./rentCastAuditQuota.js";

const rentCastSaleListingsUrl = "https://api.rentcast.io/v1/listings/sale";
const expectedState = "CA";
const expectedStatus = "Active";
const expectedPropertyType = "Single Family";
const maximumPrice = 850_000;
const minimumBedrooms = 4;
const minimumBathrooms = 2.5;
const resultLimit = 500;
const defaultTimeoutMs = 30_000;

export const fiveCityDirectCoverageAuditMarkets = Object.freeze([
  "Chino",
  "Chino Hills",
  "Eastvale",
  "Corona",
  "Jurupa Valley",
] as const);

type FiveCityDirectCoverageAuditMarket =
  (typeof fiveCityDirectCoverageAuditMarkets)[number];

export interface FiveCityDirectCoverageAuditRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  timeoutMs?: number;
}

export interface FiveCityDirectCoverageAuditAreaSummary {
  cityCounts: Readonly<Record<string, number>>;
  coverageGatePassed: boolean;
  elapsedMilliseconds: number;
  expectedCityVerified: boolean;
  invalidFilterRows: number;
  market: FiveCityDirectCoverageAuditMarket;
  maximumPrice: number | null;
  minimumPrice: number | null;
  responseBodyBytes: number;
  resultLimit: number;
  resultLimitMargin: number;
  returnedListings: number;
  returnedPageComplete: boolean;
  totalMatchingListings: number;
}

export interface FiveCityDirectCoverageAuditCombinedSummary {
  cityCounts: Readonly<Record<string, number>>;
  coverageGatePassed: boolean;
  elapsedMilliseconds: number;
  expectedCitiesVerified: boolean;
  invalidFilterRows: number;
  maximumPrice: number | null;
  minimumPrice: number | null;
  requestCount: number;
  responseBodyBytes: number;
  resultLimit: number;
  resultLimitMargin: number;
  returnedListings: number;
  returnedPagesComplete: boolean;
  totalMatchingListings: number;
}

export interface FiveCityDirectCoverageAuditSummary {
  areas: readonly FiveCityDirectCoverageAuditAreaSummary[];
  combined: FiveCityDirectCoverageAuditCombinedSummary;
}

interface AuditListing {
  bathrooms: number;
  bedrooms: number;
  city: string;
  price: number;
  propertyType: string;
  state: string;
  status: string;
}

export async function runFiveCityDirectCoverageAudit(
  runtime: FiveCityDirectCoverageAuditRuntime,
): Promise<FiveCityDirectCoverageAuditSummary> {
  const apiKey = readRequiredVariable(
    runtime.environment,
    "RENTCAST_API_KEY",
  );
  const areas: FiveCityDirectCoverageAuditAreaSummary[] = [];

  for (const market of fiveCityDirectCoverageAuditMarkets) {
    areas.push(await auditCity(runtime, apiKey, market));
  }

  return Object.freeze({
    areas: Object.freeze(areas),
    combined: combineAreaSummaries(areas),
  });
}

export function formatFiveCityDirectCoverageAuditSummary(
  summary: FiveCityDirectCoverageAuditSummary,
): string {
  const combinedPriceRange = formatPriceRange(
    summary.combined.minimumPrice,
    summary.combined.maximumPrice,
  );

  return [
    "RentCast five-city direct coverage audit completed.",
    "Request profile: five-city-direct-market-coverage-audit",
    `Audited direct city areas: ${summary.areas.length}`,
    ...formatRentCastAuditQuotaDisclosure(summary.combined.requestCount),
    "Combined provider rows before reconciliation:",
    `Coverage gate: ${summary.combined.coverageGatePassed ? "PASS" : "FAIL"}`,
    `Expected cities verified: ${summary.combined.expectedCitiesVerified ? "yes" : "no"}`,
    `Total matching listings: ${summary.combined.totalMatchingListings}`,
    `Returned listings: ${summary.combined.returnedListings}`,
    `Combined result limit: ${summary.combined.resultLimit}`,
    `Combined result-limit margin: ${summary.combined.resultLimitMargin}`,
    `Returned pages complete: ${summary.combined.returnedPagesComplete ? "yes" : "no"}`,
    `Invalid filter rows: ${summary.combined.invalidFilterRows}`,
    `Returned price range: ${combinedPriceRange}`,
    `Response body bytes: ${summary.combined.responseBodyBytes}`,
    `Elapsed milliseconds: ${summary.combined.elapsedMilliseconds}`,
    `Provider city counts: ${JSON.stringify(summary.combined.cityCounts)}`,
    "Per-city coverage:",
    ...summary.areas.flatMap((area, index) => [
      `Area ${index + 1}: ${area.market}, CA`,
      `  Coverage gate: ${area.coverageGatePassed ? "PASS" : "FAIL"}`,
      `  Expected city verified: ${area.expectedCityVerified ? "yes" : "no"}`,
      `  Total matching listings: ${area.totalMatchingListings}`,
      `  Returned listings: ${area.returnedListings}`,
      `  Result limit: ${area.resultLimit}`,
      `  Result-limit margin: ${area.resultLimitMargin}`,
      `  Returned page complete: ${area.returnedPageComplete ? "yes" : "no"}`,
      `  Invalid filter rows: ${area.invalidFilterRows}`,
      `  Returned price range: ${formatPriceRange(area.minimumPrice, area.maximumPrice)}`,
      `  Provider city counts: ${JSON.stringify(area.cityCounts)}`,
      `  Response body bytes: ${area.responseBodyBytes}`,
      `  Elapsed milliseconds: ${area.elapsedMilliseconds}`,
    ]),
    "Production request profile was not changed.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
}

async function auditCity(
  runtime: FiveCityDirectCoverageAuditRuntime,
  apiKey: string,
  market: FiveCityDirectCoverageAuditMarket,
): Promise<FiveCityDirectCoverageAuditAreaSummary> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, runtime.timeoutMs ?? defaultTimeoutMs);
  const startedAt = runtime.now();

  let response: Response;
  try {
    response = await runtime.fetch(createCoverageAuditUrl(market), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      signal: abortController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `RentCast direct city coverage audit for ${market} timed out`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMilliseconds = Math.max(0, runtime.now() - startedAt);

  if (!response.ok) {
    throw new Error(
      `RentCast direct city coverage audit for ${market} failed with status ${response.status}`,
    );
  }

  const responseText = await readResponseText(response, market);
  const listings = parseAuditListings(responseText, market);
  const totalMatchingListings = readTotalCount(response, market);

  return summarizeArea({
    elapsedMilliseconds,
    listings,
    market,
    responseBodyBytes: new TextEncoder().encode(responseText).byteLength,
    totalMatchingListings,
  });
}

function createCoverageAuditUrl(
  market: FiveCityDirectCoverageAuditMarket,
): URL {
  const url = new URL(rentCastSaleListingsUrl);
  url.searchParams.set("city", market);
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

async function readResponseText(
  response: Response,
  market: FiveCityDirectCoverageAuditMarket,
): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new Error(
      `RentCast direct city coverage response for ${market} was not valid JSON`,
    );
  }
}

function parseAuditListings(
  responseText: string,
  market: FiveCityDirectCoverageAuditMarket,
): AuditListing[] {
  let body: unknown;
  try {
    body = JSON.parse(responseText) as unknown;
  } catch {
    throwInvalidSchemaError(market);
  }

  if (!Array.isArray(body)) {
    throwInvalidSchemaError(market);
  }

  return body.map((listing) => parseAuditListing(listing, market));
}

function parseAuditListing(
  value: unknown,
  market: FiveCityDirectCoverageAuditMarket,
): AuditListing {
  if (!isRecord(value)) {
    throwInvalidSchemaError(market);
  }

  return {
    bathrooms: readFiniteNumber(value, "bathrooms", market),
    bedrooms: readFiniteNumber(value, "bedrooms", market),
    city: readString(value, "city", market),
    price: readFiniteNumber(value, "price", market),
    propertyType: readString(value, "propertyType", market),
    state: readString(value, "state", market),
    status: readString(value, "status", market),
  };
}

function readTotalCount(
  response: Response,
  market: FiveCityDirectCoverageAuditMarket,
): number {
  const value = response.headers.get("X-Total-Count");
  if (value === null || !/^\d+$/.test(value)) {
    throwInvalidTotalCountError(market);
  }

  const totalCount = Number(value);
  if (!Number.isSafeInteger(totalCount)) {
    throwInvalidTotalCountError(market);
  }

  return totalCount;
}

function summarizeArea(input: {
  elapsedMilliseconds: number;
  listings: readonly AuditListing[];
  market: FiveCityDirectCoverageAuditMarket;
  responseBodyBytes: number;
  totalMatchingListings: number;
}): FiveCityDirectCoverageAuditAreaSummary {
  const cityCounts = countBy(input.listings, (listing) => listing.city);
  const returnedListings = input.listings.length;
  const expectedCityVerified =
    returnedListings > 0 &&
    input.listings.every((listing) => listing.city === input.market);
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
  const prices = input.listings.map((listing) => listing.price);

  return Object.freeze({
    cityCounts,
    coverageGatePassed:
      input.totalMatchingListings < resultLimit &&
      returnedPageComplete &&
      expectedCityVerified &&
      invalidFilterRows === 0,
    elapsedMilliseconds: input.elapsedMilliseconds,
    expectedCityVerified,
    invalidFilterRows,
    market: input.market,
    maximumPrice: prices.length === 0 ? null : Math.max(...prices),
    minimumPrice: prices.length === 0 ? null : Math.min(...prices),
    responseBodyBytes: input.responseBodyBytes,
    resultLimit,
    resultLimitMargin,
    returnedListings,
    returnedPageComplete,
    totalMatchingListings: input.totalMatchingListings,
  });
}

function combineAreaSummaries(
  areas: readonly FiveCityDirectCoverageAuditAreaSummary[],
): FiveCityDirectCoverageAuditCombinedSummary {
  return Object.freeze({
    cityCounts: mergeCounts(areas.map((area) => area.cityCounts)),
    coverageGatePassed: areas.every((area) => area.coverageGatePassed),
    elapsedMilliseconds: sumBy(
      areas,
      (area) => area.elapsedMilliseconds,
    ),
    expectedCitiesVerified: areas.every(
      (area) => area.expectedCityVerified,
    ),
    invalidFilterRows: sumBy(areas, (area) => area.invalidFilterRows),
    maximumPrice: maximumNullable(areas.map((area) => area.maximumPrice)),
    minimumPrice: minimumNullable(areas.map((area) => area.minimumPrice)),
    requestCount: areas.length,
    responseBodyBytes: sumBy(areas, (area) => area.responseBodyBytes),
    resultLimit: sumBy(areas, (area) => area.resultLimit),
    resultLimitMargin: sumBy(areas, (area) => area.resultLimitMargin),
    returnedListings: sumBy(areas, (area) => area.returnedListings),
    returnedPagesComplete: areas.every(
      (area) => area.returnedPageComplete,
    ),
    totalMatchingListings: sumBy(
      areas,
      (area) => area.totalMatchingListings,
    ),
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

  return freezeCounts(counts);
}

function mergeCounts(
  values: readonly Readonly<Record<string, number>>[],
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();

  for (const value of values) {
    for (const [key, count] of Object.entries(value)) {
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }

  return freezeCounts(counts);
}

function freezeCounts(
  counts: ReadonlyMap<string, number>,
): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function sumBy<T>(
  values: readonly T[],
  selectValue: (value: T) => number,
): number {
  return values.reduce(
    (total, value) => total + selectValue(value),
    0,
  );
}

function minimumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

function maximumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

function formatPriceRange(
  minimum: number | null,
  maximum: number | null,
): string {
  if (minimum === null || maximum === null) {
    return "none";
  }

  return `${formatCurrency(minimum)} to ${formatCurrency(maximum)}`;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  })}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  market: FiveCityDirectCoverageAuditMarket,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throwInvalidSchemaError(market);
  }

  return value;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  market: FiveCityDirectCoverageAuditMarket,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalidSchemaError(market);
  }

  return value;
}

function throwInvalidSchemaError(
  market: FiveCityDirectCoverageAuditMarket,
): never {
  throw new Error(
    `RentCast direct city coverage response for ${market} did not match the expected audit schema`,
  );
}

function throwInvalidTotalCountError(
  market: FiveCityDirectCoverageAuditMarket,
): never {
  throw new Error(
    `RentCast direct city coverage response for ${market} did not include a valid X-Total-Count header`,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
