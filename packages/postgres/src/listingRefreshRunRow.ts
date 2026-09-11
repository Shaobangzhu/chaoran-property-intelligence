import {
  normalizeListingRefreshRun,
  type ListingRefreshRun,
  type QueueListingRefreshInput,
} from "@chaoran-property-intelligence/application";

import { readRecord, readString } from "./listingRow.js";
import type { SqlConnection, SqlQueryResult } from "./sqlDatabase.js";

export const listingRefreshRunColumns = `
  run_id,
  profile_key,
  requested_revision,
  effective_revision,
  trigger_reason,
  status,
  claim_token,
  requested_at,
  started_at,
  completed_at,
  selected_markets,
  selected_market_count,
  planned_provider_request_count,
  actual_provider_request_count,
  returned_listing_count,
  published_current_count,
  failure_code,
  superseded_by_run_id
`;

export async function insertQueuedListingRefreshRun(
  connection: SqlConnection,
  input: QueueListingRefreshInput,
): Promise<ListingRefreshRun | null> {
  const result = await connection.query(
    `INSERT INTO listing_search_runs (
       run_id,
       profile_key,
       requested_revision,
       trigger_reason,
       requested_at,
       selected_markets,
       selected_market_count,
       planned_provider_request_count
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING ${listingRefreshRunColumns}`,
    [
      input.runId,
      input.profileKey,
      input.revision,
      input.triggerReason,
      input.requestedAt,
      JSON.stringify(input.plan.selectedMarkets),
      input.plan.selectedMarketCount,
      input.plan.plannedProviderRequestCount,
    ],
  );
  return result.rows.length === 0
    ? null
    : parseRequiredListingRefreshRun(result);
}

export function parseRequiredListingRefreshRun(
  result: SqlQueryResult,
): ListingRefreshRun {
  if (result.rows.length !== 1) {
    throwInvalidRunRow();
  }
  return parseListingRefreshRun(result.rows[0]);
}

export function parseListingRefreshRun(value: unknown): ListingRefreshRun {
  const row = readRecord(value);
  try {
    return normalizeListingRefreshRun({
      runId: readString(row, "run_id"),
      profileKey: readString(row, "profile_key"),
      requestedRevision: readSafeInteger(row.requested_revision),
      effectiveRevision: readNullableSafeInteger(row.effective_revision),
      triggerReason: readString(row, "trigger_reason"),
      status: readString(row, "status"),
      requestedAt: readTimestamp(row.requested_at),
      startedAt: readNullableTimestamp(row.started_at),
      completedAt: readNullableTimestamp(row.completed_at),
      selectedMarkets: row.selected_markets,
      selectedMarketCount: readSafeInteger(row.selected_market_count),
      plannedProviderRequestCount: readSafeInteger(
        row.planned_provider_request_count,
      ),
      actualProviderRequestCount: readSafeInteger(
        row.actual_provider_request_count,
      ),
      returnedListingCount: readSafeInteger(row.returned_listing_count),
      publishedCurrentCount: readSafeInteger(row.published_current_count),
      failureCode:
        row.failure_code === null ? null : readString(row, "failure_code"),
      supersededByRunId:
        row.superseded_by_run_id === null
          ? null
          : readString(row, "superseded_by_run_id"),
    });
  } catch {
    return throwInvalidRunRow();
  }
}

export function readTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return throwInvalidRunRow();
  }
  return value.toISOString();
}

export function readNullableTimestamp(value: unknown): string | null {
  return value === null ? null : readTimestamp(value);
}

export function readSafeInteger(value: unknown): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    return throwInvalidRunRow();
  }
  return parsed;
}

function readNullableSafeInteger(value: unknown): number | null {
  return value === null ? null : readSafeInteger(value);
}

function throwInvalidRunRow(): never {
  throw new Error(
    "PostgreSQL listing refresh run row did not match the expected schema",
  );
}
