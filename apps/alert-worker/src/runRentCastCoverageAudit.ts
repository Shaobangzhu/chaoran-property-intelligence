import {
  RentCastSaleListingsClient,
  type RentCastSaleListingsCoveragePage,
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

export interface RentCastCoverageAuditSummary {
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

export async function runRentCastCoverageAudit(
  runtime: RentCastCoverageAuditRuntime,
): Promise<RentCastCoverageAuditSummary> {
  const apiKey = readRequiredVariable(
    runtime.environment,
    "RENTCAST_API_KEY",
  );
  const client = new RentCastSaleListingsClient({
    apiKey,
    fetch: runtime.fetch,
  });
  const startedAt = runtime.now();
  const page = await client.searchSaleListingsForCoverageAudit();
  const elapsedMilliseconds = Math.max(0, runtime.now() - startedAt);

  return summarizeCoveragePage(page, elapsedMilliseconds);
}

export function formatRentCastCoverageAuditSummary(
  summary: RentCastCoverageAuditSummary,
): string {
  const priceRange =
    summary.minimumPrice === null || summary.maximumPrice === null
      ? "none"
      : `${formatCurrency(summary.minimumPrice)} to ${formatCurrency(summary.maximumPrice)}`;

  return [
    "RentCast price-drop coverage audit completed.",
    "Request profile: price-drop-coverage-audit",
    `Coverage gate: ${summary.coverageGatePassed ? "PASS" : "FAIL"}`,
    `Total matching listings: ${summary.totalMatchingListings}`,
    `Returned listings: ${summary.returnedListings}`,
    `Result limit: ${summary.resultLimit}`,
    `Result limit margin: ${summary.resultLimitMargin}`,
    `Returned page complete: ${summary.returnedPageComplete ? "yes" : "no"}`,
    `Below $780,000: ${summary.belowProductionFloorListings}`,
    `Returned price range: ${priceRange}`,
    `Response body bytes: ${summary.responseBodyBytes}`,
    `Elapsed milliseconds: ${summary.elapsedMilliseconds}`,
    "Target-city returned listings:",
    ...targetCities.map(
      (city) => `  ${city}: ${summary.targetCityListings[city]}`,
    ),
    `Non-target-city returned listings: ${summary.nonTargetCityListings}`,
    "Production request profile was not changed.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
}

function summarizeCoveragePage(
  page: RentCastSaleListingsCoveragePage,
  elapsedMilliseconds: number,
): RentCastCoverageAuditSummary {
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
