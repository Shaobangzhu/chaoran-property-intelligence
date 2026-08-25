import { formatRentCastAuditQuotaDisclosure } from "./rentCastAuditQuota.js";
import {
  runDirectCityCoverageAudit,
  type DirectCityCoverageAuditAreaSummary,
  type DirectCityCoverageAuditRuntime,
} from "./runFiveCityDirectCoverageAudit.js";

export const irvineCoverageAuditMarket = "Irvine" as const;

export type IrvineCoverageAuditRuntime = DirectCityCoverageAuditRuntime;
export type IrvineCoverageAuditSummary =
  DirectCityCoverageAuditAreaSummary<typeof irvineCoverageAuditMarket>;

export async function runIrvineCoverageAudit(
  runtime: IrvineCoverageAuditRuntime,
): Promise<IrvineCoverageAuditSummary> {
  return runDirectCityCoverageAudit(runtime, irvineCoverageAuditMarket);
}

export function formatIrvineCoverageAuditSummary(
  summary: IrvineCoverageAuditSummary,
): string {
  return [
    "RentCast Irvine direct coverage audit completed.",
    "Request profile: irvine-ca-direct-market-coverage-audit",
    ...formatRentCastAuditQuotaDisclosure(1),
    `Coverage gate: ${summary.coverageGatePassed ? "PASS" : "FAIL"}`,
    `Expected city verified: ${summary.expectedCityVerified ? "yes" : "no"}`,
    `Total matching listings: ${summary.totalMatchingListings}`,
    `Returned listings: ${summary.returnedListings}`,
    `Result limit: ${summary.resultLimit}`,
    `Result-limit margin: ${summary.resultLimitMargin}`,
    `Returned page complete: ${summary.returnedPageComplete ? "yes" : "no"}`,
    `Invalid filter rows: ${summary.invalidFilterRows}`,
    `Returned price range: ${formatPriceRange(
      summary.minimumPrice,
      summary.maximumPrice,
    )}`,
    `Provider city counts: ${JSON.stringify(summary.cityCounts)}`,
    `Response body bytes: ${summary.responseBodyBytes}`,
    `Elapsed milliseconds: ${summary.elapsedMilliseconds}`,
    "Production request profile was not changed.",
    "No credentials, request URL, raw response, or street address was logged.",
    "",
  ].join("\n");
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
