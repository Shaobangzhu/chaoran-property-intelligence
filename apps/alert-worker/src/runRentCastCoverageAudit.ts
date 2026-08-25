import {
  defaultRentCastSaleListingsSearchArea,
  defaultRentCastSaleListingsSearchCriteria,
  RentCastSaleListingsClient,
  type RentCastSaleListingsCoveragePage,
  type RentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

import { readRequiredVariable } from "./productionConfig.js";

const productionMinimumPrice = 780_000;
const targetCities = [
  "Chino",
  "Chino Hills",
  "Corona",
  "Eastvale",
  "Jurupa Valley",
] as const;

type TargetCity = (typeof targetCities)[number];

export interface RentCastCoverageAuditRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
}

export interface RentCastCoverageAuditMetrics {
  belowProductionFloorListings: number;
  coverageGatePassed: boolean;
  elapsedMilliseconds: number;
  maximumPrice: number | null;
  minimumPrice: number | null;
  nonTargetCityListings: number;
  responseBodyBytes: number;
  resultLimit: number;
  resultLimitMargin: number;
  returnedPageComplete: boolean;
  returnedListings: number;
  targetCityListings: Record<TargetCity, number>;
  totalMatchingListings: number;
}

export interface RentCastCoverageAuditAreaSummary
  extends RentCastCoverageAuditMetrics {
  areaLabel: string;
}

export interface RentCastCoverageAuditSummary {
  areas: readonly RentCastCoverageAuditAreaSummary[];
  combined: RentCastCoverageAuditMetrics;
}

export interface RentCastCoverageAuditOptions {
  searchAreas?: readonly RentCastSaleListingsSearchArea[];
}

const defaultCoverageAuditSearchAreas = Object.freeze([
  defaultRentCastSaleListingsSearchArea,
]);

export async function runRentCastCoverageAudit(
  runtime: RentCastCoverageAuditRuntime,
  options: RentCastCoverageAuditOptions = {},
): Promise<RentCastCoverageAuditSummary> {
  const searchAreas = options.searchAreas ?? defaultCoverageAuditSearchAreas;
  if (!Array.isArray(searchAreas) || searchAreas.length === 0) {
    throw new Error("RentCast coverage audit search areas were invalid");
  }

  const apiKey = readRequiredVariable(
    runtime.environment,
    "RENTCAST_API_KEY",
  );
  const client = new RentCastSaleListingsClient({
    apiKey,
    fetch: runtime.fetch,
  });
  const areas: RentCastCoverageAuditAreaSummary[] = [];

  for (const [index, searchArea] of searchAreas.entries()) {
    const startedAt = runtime.now();
    const page = await client.searchSaleListingsForCoverageAudit(
      defaultRentCastSaleListingsSearchCriteria,
      searchArea,
    );
    const elapsedMilliseconds = Math.max(0, runtime.now() - startedAt);
    areas.push({
      areaLabel: describeSearchArea(searchArea, index),
      ...summarizeCoveragePage(page, elapsedMilliseconds),
    });
  }

  return {
    areas: Object.freeze(areas),
    combined: combineCoverageMetrics(areas),
  };
}

export function formatRentCastCoverageAuditSummary(
  summary: RentCastCoverageAuditSummary,
): string {
  const combined = summary.combined;
  const priceRange =
    combined.minimumPrice === null || combined.maximumPrice === null
      ? "none"
      : `${formatCurrency(combined.minimumPrice)} to ${formatCurrency(
          combined.maximumPrice,
        )}`;

  return [
    "RentCast price-drop coverage audit completed.",
    "Request profile: price-drop-coverage-audit",
    `Audited areas: ${summary.areas.length}`,
    "Combined provider rows before reconciliation:",
    `Coverage gate: ${combined.coverageGatePassed ? "PASS" : "FAIL"}`,
    `Total matching listings: ${combined.totalMatchingListings}`,
    `Returned listings: ${combined.returnedListings}`,
    `Result limit: ${combined.resultLimit}`,
    `Result limit margin: ${combined.resultLimitMargin}`,
    `Returned page complete: ${combined.returnedPageComplete ? "yes" : "no"}`,
    `Below $780,000: ${combined.belowProductionFloorListings}`,
    `Returned price range: ${priceRange}`,
    `Response body bytes: ${combined.responseBodyBytes}`,
    `Elapsed milliseconds: ${combined.elapsedMilliseconds}`,
    "Target-city returned listings:",
    ...targetCities.map(
      (city) => `  ${city}: ${combined.targetCityListings[city]}`,
    ),
    `Non-target-city returned listings: ${combined.nonTargetCityListings}`,
    "Per-area coverage:",
    ...summary.areas.flatMap((area, index) => [
      `Area ${index + 1}: ${area.areaLabel}`,
      `  Coverage gate: ${area.coverageGatePassed ? "PASS" : "FAIL"}`,
      `  Total matching listings: ${area.totalMatchingListings}`,
      `  Returned listings: ${area.returnedListings}`,
      `  Result limit: ${area.resultLimit}`,
      `  Result limit margin: ${area.resultLimitMargin}`,
      `  Returned page complete: ${area.returnedPageComplete ? "yes" : "no"}`,
      `  Response body bytes: ${area.responseBodyBytes}`,
      `  Elapsed milliseconds: ${area.elapsedMilliseconds}`,
    ]),
    "This audit did not mutate the production request profile.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
}

function summarizeCoveragePage(
  page: RentCastSaleListingsCoveragePage,
  elapsedMilliseconds: number,
): RentCastCoverageAuditMetrics {
  const targetCityListings = createEmptyTargetCityCounts();
  let belowProductionFloorListings = 0;
  let nonTargetCityListings = 0;
  let minimumPrice: number | null = null;
  let maximumPrice: number | null = null;

  for (const listing of page.listings) {
    if (listing.price < productionMinimumPrice) {
      belowProductionFloorListings += 1;
    }

    minimumPrice =
      minimumPrice === null
        ? listing.price
        : Math.min(minimumPrice, listing.price);
    maximumPrice =
      maximumPrice === null
        ? listing.price
        : Math.max(maximumPrice, listing.price);

    if (isTargetCityName(listing.city)) {
      targetCityListings[listing.city] += 1;
    } else {
      nonTargetCityListings += 1;
    }
  }

  const returnedPageComplete =
    page.listings.length === Math.min(page.totalCount, page.resultLimit);

  return {
    belowProductionFloorListings,
    coverageGatePassed:
      page.totalCount < page.resultLimit && returnedPageComplete,
    elapsedMilliseconds,
    maximumPrice,
    minimumPrice,
    nonTargetCityListings,
    responseBodyBytes: page.responseBodyBytes,
    resultLimit: page.resultLimit,
    resultLimitMargin: Math.max(0, page.resultLimit - page.totalCount),
    returnedPageComplete,
    returnedListings: page.listings.length,
    targetCityListings,
    totalMatchingListings: page.totalCount,
  };
}

function combineCoverageMetrics(
  areas: readonly RentCastCoverageAuditAreaSummary[],
): RentCastCoverageAuditMetrics {
  const targetCityListings = createEmptyTargetCityCounts();
  let minimumPrice: number | null = null;
  let maximumPrice: number | null = null;

  for (const area of areas) {
    minimumPrice = minimumNullable(minimumPrice, area.minimumPrice);
    maximumPrice = maximumNullable(maximumPrice, area.maximumPrice);
    for (const city of targetCities) {
      targetCityListings[city] += area.targetCityListings[city];
    }
  }

  return {
    belowProductionFloorListings: sumBy(
      areas,
      (area) => area.belowProductionFloorListings,
    ),
    coverageGatePassed: areas.every((area) => area.coverageGatePassed),
    elapsedMilliseconds: sumBy(areas, (area) => area.elapsedMilliseconds),
    maximumPrice,
    minimumPrice,
    nonTargetCityListings: sumBy(
      areas,
      (area) => area.nonTargetCityListings,
    ),
    responseBodyBytes: sumBy(areas, (area) => area.responseBodyBytes),
    resultLimit: sumBy(areas, (area) => area.resultLimit),
    resultLimitMargin: sumBy(areas, (area) => area.resultLimitMargin),
    returnedPageComplete: areas.every((area) => area.returnedPageComplete),
    returnedListings: sumBy(areas, (area) => area.returnedListings),
    targetCityListings,
    totalMatchingListings: sumBy(
      areas,
      (area) => area.totalMatchingListings,
    ),
  };
}

function describeSearchArea(
  area: RentCastSaleListingsSearchArea,
  index: number,
): string {
  if (area.kind === "zip") {
    return `ZIP ${area.zipCode}`;
  }

  if (area.kind === "city") {
    return `City ${area.city}, CA`;
  }

  if (
    area.address === defaultRentCastSaleListingsSearchArea.address &&
    area.radiusMiles === defaultRentCastSaleListingsSearchArea.radiusMiles
  ) {
    return `Brea radius (${area.radiusMiles} mi)`;
  }

  return `Radius area ${index + 1} (${area.radiusMiles} mi)`;
}

function minimumNullable(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.min(left, right);
}

function maximumNullable(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}

function sumBy<T>(
  values: readonly T[],
  select: (value: T) => number,
): number {
  return values.reduce((total, value) => total + select(value), 0);
}

function createEmptyTargetCityCounts(): Record<TargetCity, number> {
  return {
    Chino: 0,
    "Chino Hills": 0,
    Corona: 0,
    Eastvale: 0,
    "Jurupa Valley": 0,
  };
}

function isTargetCityName(city: string): city is TargetCity {
  return (targetCities as readonly string[]).includes(city);
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  })}`;
}
