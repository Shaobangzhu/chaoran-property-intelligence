import {
  LISTING_REFRESH_LIMITS,
  normalizeListingSearchMembership,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type CurrentListingInventory,
  type CurrentListingInventoryQueryPort,
  type HistoricalListingInventoryQueryPort,
  type ListingHistoryPage,
  type ListingHistoryQuery,
  type ListingInventoryItem,
  type ListingSearchMembership,
} from "@chaoran-property-intelligence/application";
import {
  isListingMembershipLifecycleState,
  type ListingMembershipLifecycleState,
} from "@chaoran-property-intelligence/domain";

import {
  normalizedListingColumns,
  parseNormalizedListing,
  readRecord,
  readString,
} from "./listingRow.js";
import { readSafeInteger, readTimestamp } from "./listingRefreshRunRow.js";
import type { SqlDatabase } from "./sqlDatabase.js";

const inventoryColumns = `
  l.id AS listing_id,
  ${normalizedListingColumns
    .split("\n")
    .map((column) => `l.${column.trim()}`)
    .join("\n")},
  m.profile_key,
  m.applied_revision,
  m.last_successful_run_id,
  m.lifecycle_state,
  m.first_matched_at,
  m.last_matched_at,
  m.last_server_observed_at,
  m.consecutive_complete_run_absence_count,
  m.inactive_at,
  m.explicit_provider_status,
  m.explicit_provider_status_observed_at,
  m.lifecycle_changed_at
`;

export class PostgresListingInventoryQuery
  implements CurrentListingInventoryQueryPort, HistoricalListingInventoryQueryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async findCurrentInventory(): Promise<CurrentListingInventory | null> {
    const stateResult = await this.database.query(
      `SELECT p.applied_revision, r.completed_at
       FROM listing_search_profiles p
       JOIN listing_search_runs r
         ON r.profile_key = p.profile_key
        AND r.effective_revision = p.applied_revision
        AND r.status = 'succeeded'
       WHERE p.profile_key = $1
       ORDER BY r.completed_at DESC, r.run_id DESC
       LIMIT 1`,
      [PRIMARY_LISTING_SEARCH_PROFILE_KEY],
    );
    if (stateResult.rows.length === 0) {
      return null;
    }
    const state = readRecord(stateResult.rows[0]);
    const appliedRevision = readSafeInteger(state.applied_revision);
    if (appliedRevision < 1) {
      throwInvalidInventoryRow();
    }
    const refreshedAt = readTimestamp(state.completed_at);

    const result = await this.database.query(
      `SELECT ${inventoryColumns}
       FROM listing_search_memberships m
       JOIN listings l ON l.id = m.listing_id
       WHERE m.profile_key = $1
         AND m.applied_revision = $2
         AND m.lifecycle_state = 'current'
       ORDER BY l.listed_date DESC NULLS LAST, l.id ASC`,
      [PRIMARY_LISTING_SEARCH_PROFILE_KEY, appliedRevision],
    );
    return Object.freeze({
      profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
      appliedRevision,
      refreshedAt,
      items: Object.freeze(result.rows.map(parseInventoryItem)),
    });
  }

  async findListingHistory(
    query: ListingHistoryQuery,
  ): Promise<ListingHistoryPage> {
    const normalized = normalizeHistoryQuery(query);
    const cursor = decodeCursor(normalized.cursor);
    const result = await this.database.query(
      `SELECT ${inventoryColumns}
       FROM listing_search_memberships m
       JOIN listings l ON l.id = m.listing_id
       WHERE m.profile_key = $1
         AND m.lifecycle_state = ANY($2::text[])
         AND (
           $3::timestamptz IS NULL
           OR m.lifecycle_changed_at < $3
           OR (m.lifecycle_changed_at = $3 AND m.listing_id > $4::uuid)
         )
       ORDER BY m.lifecycle_changed_at DESC, m.listing_id ASC
       LIMIT $5`,
      [
        PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        normalized.lifecycleStates,
        cursor?.lifecycleChangedAt ?? null,
        cursor?.listingId ?? null,
        normalized.limit + 1,
      ],
    );
    const pageRows = result.rows.slice(0, normalized.limit);
    const items = pageRows.map(parseInventoryItem);
    const lastRow = pageRows.at(-1);
    const nextCursor =
      result.rows.length > normalized.limit && lastRow !== undefined
        ? encodeCursor({
            lifecycleChangedAt: readTimestamp(
              readRecord(lastRow).lifecycle_changed_at,
            ),
            listingId: readString(readRecord(lastRow), "listing_id"),
          })
        : null;
    return Object.freeze({ items: Object.freeze(items), nextCursor });
  }
}

function parseInventoryItem(value: unknown): ListingInventoryItem {
  const row = readRecord(value);
  const membership = parseMembership(row);
  const listingId = readString(row, "listing_id");
  if (membership.listingId !== listingId) {
    return throwInvalidInventoryRow();
  }
  return Object.freeze({
    listingId,
    listing: Object.freeze(parseNormalizedListing(row)),
    membership,
    acquisitionEligible: true,
    currentDisplayEligible: membership.lifecycleState === "current",
  });
}

function parseMembership(
  row: Record<string, unknown>,
): ListingSearchMembership {
  try {
    return normalizeListingSearchMembership({
      profileKey: readString(row, "profile_key"),
      listingId: readString(row, "listing_id"),
      appliedRevision: readSafeInteger(row.applied_revision),
      lastSuccessfulRunId: readString(row, "last_successful_run_id"),
      lifecycleState: readString(row, "lifecycle_state"),
      firstMatchedAt: readTimestamp(row.first_matched_at),
      lastMatchedAt: readTimestamp(row.last_matched_at),
      lastServerObservedAt: readTimestamp(row.last_server_observed_at),
      consecutiveCompleteRunAbsenceCount: readSafeInteger(
        row.consecutive_complete_run_absence_count,
      ),
      inactiveAt:
        row.inactive_at === null ? null : readTimestamp(row.inactive_at),
      explicitProviderStatus:
        row.explicit_provider_status === null
          ? null
          : readString(row, "explicit_provider_status"),
      explicitProviderStatusObservedAt:
        row.explicit_provider_status_observed_at === null
          ? null
          : readTimestamp(row.explicit_provider_status_observed_at),
    });
  } catch {
    return throwInvalidInventoryRow();
  }
}

interface HistoryCursor {
  readonly lifecycleChangedAt: string;
  readonly listingId: string;
}

function normalizeHistoryQuery(query: ListingHistoryQuery): ListingHistoryQuery {
  if (
    !Array.isArray(query.lifecycleStates) ||
    query.lifecycleStates.length === 0 ||
    new Set(query.lifecycleStates).size !== query.lifecycleStates.length ||
    !query.lifecycleStates.every(isListingMembershipLifecycleState) ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > LISTING_REFRESH_LIMITS.maximumHistoryPageSize ||
    (query.cursor !== null &&
      (typeof query.cursor !== "string" ||
        query.cursor.length === 0 ||
        query.cursor.length > LISTING_REFRESH_LIMITS.maximumHistoryCursorLength))
  ) {
    return throwInvalidHistoryQuery();
  }
  return Object.freeze({
    lifecycleStates: Object.freeze([
      ...(query.lifecycleStates as readonly ListingMembershipLifecycleState[]),
    ]),
    cursor: query.cursor,
    limit: query.limit,
  });
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): HistoryCursor | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return throwInvalidHistoryQuery();
    }
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      !isCanonicalTimestamp(record.lifecycleChangedAt) ||
      typeof record.listingId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        record.listingId,
      )
    ) {
      return throwInvalidHistoryQuery();
    }
    return {
      lifecycleChangedAt: record.lifecycleChangedAt,
      listingId: record.listingId,
    };
  } catch {
    return throwInvalidHistoryQuery();
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function throwInvalidHistoryQuery(): never {
  throw new Error("Listing history query was invalid");
}

function throwInvalidInventoryRow(): never {
  throw new Error(
    "PostgreSQL listing inventory row did not match the expected schema",
  );
}
