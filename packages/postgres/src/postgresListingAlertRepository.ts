import {
  assertValidListingAlertBaselineEntry,
  assertValidListingAlertTransition,
  createNewListingAlertEventKey,
  InvalidListingAlertStateError,
  listingAlertEventSchema,
  listingPriceObservationSchema,
  listingPriceObservationsEqual,
  ListingAlertObservationConflictError,
  type ListingAlertBaselineEntry,
  type ListingAlertEvent,
  type ListingAlertStateRepositoryPort,
  type ListingAlertTransition,
  type ListingPriceObservation,
} from "@chaoran-property-intelligence/application";
import {
  createListingAddressKey,
  type ListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  normalizedListingColumns,
  parseNormalizedListing,
  readRecord,
  readString,
  throwInvalidListingRowError,
} from "./listingRow.js";
import type {
  SqlConnection,
  SqlDatabase,
} from "./sqlDatabase.js";

const legacyBaselineStateKey = "baseline_initialized";
const priceObservationBaselineStateKey =
  "price_observation_baseline_initialized";
const baselineAdvisoryLockKey = "cpi:listing-alert-baseline:v1";

const listingColumns = `
  deduplication_key,
  ${normalizedListingColumns},
  notification_status
`;

const upsertListingSql = `
  INSERT INTO listings (
    deduplication_key,
    ${normalizedListingColumns},
    notification_status
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
  )
  ON CONFLICT (deduplication_key) DO UPDATE SET
    source_listing_id = EXCLUDED.source_listing_id,
    mls_name = EXCLUDED.mls_name,
    mls_number = EXCLUDED.mls_number,
    formatted_address = EXCLUDED.formatted_address,
    address_line_1 = EXCLUDED.address_line_1,
    address_line_2 = EXCLUDED.address_line_2,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    zip_code = EXCLUDED.zip_code,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    property_type = EXCLUDED.property_type,
    bedrooms = EXCLUDED.bedrooms,
    bathrooms = EXCLUDED.bathrooms,
    price = EXCLUDED.price,
    status = EXCLUDED.status,
    listed_date = EXCLUDED.listed_date,
    last_seen_date = EXCLUDED.last_seen_date,
    notification_status = CASE
      WHEN listings.notification_status = 'baseline'
        AND EXCLUDED.notification_status = 'pending'
        THEN 'pending'
      ELSE listings.notification_status
    END,
    updated_at = now()
`;

const upsertObservationSql = `
  INSERT INTO listing_price_observations (
    address_key,
    listing_key,
    source_listing_id,
    latest_price,
    latest_listed_date,
    latest_last_seen_date,
    comparison_ready,
    observed_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (address_key) DO UPDATE SET
    listing_key = EXCLUDED.listing_key,
    source_listing_id = EXCLUDED.source_listing_id,
    latest_price = EXCLUDED.latest_price,
    latest_listed_date = EXCLUDED.latest_listed_date,
    latest_last_seen_date = EXCLUDED.latest_last_seen_date,
    comparison_ready = EXCLUDED.comparison_ready,
    observed_at = EXCLUDED.observed_at,
    updated_at = now()
`;

export class PostgresListingAlertRepository
  implements ListingAlertStateRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async isPriceObservationBaselineInitialized(): Promise<boolean> {
    return stateMarkerExists(this.database, priceObservationBaselineStateKey);
  }

  async initializePriceObservationBaseline(
    entries: readonly ListingAlertBaselineEntry[],
  ): Promise<void> {
    assertUniqueBaselineAddresses(entries);
    for (const entry of entries) {
      assertValidListingAlertBaselineEntry(entry);
    }

    await this.database.transaction(async (connection) => {
      await acquireAdvisoryLock(connection, baselineAdvisoryLockKey);
      if (
        await stateMarkerExists(
          connection,
          priceObservationBaselineStateKey,
        )
      ) {
        return;
      }

      for (const entry of entries) {
        await upsertListing(
          connection,
          entry.listing,
          entry.observation.listingKey,
          "baseline",
        );
        await upsertObservation(connection, entry.observation);
      }
      await insertStateMarker(connection, priceObservationBaselineStateKey);
    });
  }

  async initializeLegacyListingAlertState(): Promise<void> {
    await this.database.transaction(async (connection) => {
      await acquireAdvisoryLock(connection, baselineAdvisoryLockKey);
      if (
        await stateMarkerExists(
          connection,
          priceObservationBaselineStateKey,
        )
      ) {
        return;
      }
      if (!(await stateMarkerExists(connection, legacyBaselineStateKey))) {
        return;
      }

      const result = await connection.query(
        `SELECT ${listingColumns}
         FROM listings
         WHERE source = 'rentcast'
         ORDER BY last_seen_date DESC,
                  listed_date DESC,
                  first_discovered_at DESC,
                  deduplication_key DESC`,
      );
      const legacyRows = result.rows.map(parseLegacyListingRow);
      const observations = selectLatestLegacyObservations(legacyRows);

      for (const observation of observations) {
        await insertLegacyObservation(connection, observation);
      }
      for (const row of legacyRows) {
        if (row.notificationStatus === "pending") {
          await persistEvent(connection, createLegacyPendingEvent(row));
        }
      }

      await insertStateMarker(connection, priceObservationBaselineStateKey);
    });
  }

  async findPriceObservations(
    addressKeys: readonly ListingAddressKey[],
  ): Promise<ListingPriceObservation[]> {
    if (addressKeys.length === 0) {
      return [];
    }

    const uniqueAddressKeys = [...new Set(addressKeys)];
    const result = await this.database.query(
      `SELECT
         address_key,
         listing_key,
         source_listing_id,
         latest_price,
         latest_listed_date,
         latest_last_seen_date,
         comparison_ready,
         observed_at
       FROM listing_price_observations
       WHERE address_key = ANY($1::text[])
       ORDER BY array_position($1::text[], address_key)`,
      [uniqueAddressKeys],
    );

    return result.rows.map(parseObservationRow);
  }

  async saveListingAlertTransitions(
    transitions: readonly ListingAlertTransition[],
  ): Promise<void> {
    assertUniqueTransitionAddresses(transitions);
    for (const transition of transitions) {
      assertValidListingAlertTransition(transition);
    }
    if (transitions.length === 0) {
      return;
    }

    const addressKeys = transitions
      .map((transition) => transition.observation.addressKey)
      .sort((first, second) => first.localeCompare(second));

    await this.database.transaction(async (connection) => {
      for (const addressKey of addressKeys) {
        await acquireAdvisoryLock(connection, `cpi:listing-alert:${addressKey}`);
      }

      const result = await connection.query(
        `SELECT
           address_key,
           listing_key,
           source_listing_id,
           latest_price,
           latest_listed_date,
           latest_last_seen_date,
           comparison_ready,
           observed_at
         FROM listing_price_observations
         WHERE address_key = ANY($1::text[])
         FOR UPDATE`,
        [addressKeys],
      );
      const currentByAddress = new Map(
        result.rows.map((row) => {
          const observation = parseObservationRow(row);
          return [observation.addressKey, observation] as const;
        }),
      );

      for (const transition of transitions) {
        const addressKey = transition.observation.addressKey;
        const current = currentByAddress.get(addressKey) ?? null;
        if (
          !listingPriceObservationsEqual(
            current,
            transition.expectedPreviousObservation,
          )
        ) {
          throw new ListingAlertObservationConflictError(addressKey);
        }
      }

      for (const transition of transitions) {
        await upsertListing(
          connection,
          transition.listing,
          transition.observation.listingKey,
          transition.event?.kind === "new-listing" ? "pending" : "sent",
        );
        await upsertObservation(connection, transition.observation);
        if (transition.event !== null) {
          await persistEvent(connection, transition.event);
        }
      }
    });
  }

  async findPendingListingAlertEvents(): Promise<ListingAlertEvent[]> {
    const result = await this.database.query(
      `SELECT
         event_key,
         listing_key,
         address_key,
         kind,
         formatted_address,
         previous_price,
         current_price,
         status,
         observed_at
       FROM listing_alert_events
       WHERE status = 'pending'
       ORDER BY observed_at, event_key`,
    );

    return result.rows.map(parseEventRow);
  }

  async markListingAlertEventsSent(
    eventKeys: readonly string[],
  ): Promise<void> {
    const uniqueEventKeys = [...new Set(eventKeys)];
    if (uniqueEventKeys.length === 0) {
      return;
    }

    await this.database.transaction(async (connection) => {
      const result = await connection.query(
        `UPDATE listing_alert_events
         SET status = 'sent',
             sent_at = now()
         WHERE event_key = ANY($1::text[])
           AND status = 'pending'
         RETURNING event_key, kind, listing_key`,
        [uniqueEventKeys],
      );
      const listingKeys = result.rows
        .map(parseSentEventReference)
        .filter((event) => event.kind === "new-listing")
        .map((event) => event.listingKey);

      if (listingKeys.length > 0) {
        await connection.query(
          `UPDATE listings
           SET notification_status = 'sent',
               updated_at = now()
           WHERE deduplication_key = ANY($1::text[])
             AND notification_status = 'pending'`,
          [[...new Set(listingKeys)]],
        );
      }
    });
  }
}

interface LegacyListingRow {
  listingKey: string;
  listing: RentCastNormalizedListing;
  notificationStatus: "baseline" | "pending" | "sent";
  observation: ListingPriceObservation;
}

async function stateMarkerExists(
  connection: SqlConnection,
  stateKey: string,
): Promise<boolean> {
  const result = await connection.query(
    `SELECT state_key
     FROM alert_worker_state
     WHERE state_key = $1
     LIMIT 1`,
    [stateKey],
  );
  return result.rows.length > 0;
}

async function insertStateMarker(
  connection: SqlConnection,
  stateKey: string,
): Promise<void> {
  await connection.query(
    `INSERT INTO alert_worker_state (state_key)
     VALUES ($1)
     ON CONFLICT (state_key) DO NOTHING`,
    [stateKey],
  );
}

async function acquireAdvisoryLock(
  connection: SqlConnection,
  key: string,
): Promise<void> {
  await connection.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [key],
  );
}

async function upsertListing(
  connection: SqlConnection,
  listing: RentCastNormalizedListing,
  listingKey: string,
  notificationStatus: "baseline" | "pending" | "sent",
): Promise<void> {
  await connection.query(upsertListingSql, [
    listingKey,
    listing.source,
    listing.sourceListingId,
    listing.mlsName,
    listing.mlsNumber,
    listing.formattedAddress,
    listing.addressLine1,
    listing.addressLine2,
    listing.city,
    listing.state,
    listing.zipCode,
    listing.latitude,
    listing.longitude,
    listing.propertyType,
    listing.bedrooms,
    listing.bathrooms,
    listing.price,
    listing.status,
    listing.listedDate,
    listing.lastSeenDate,
    listing.firstDiscoveredAt,
    notificationStatus,
  ]);
}

async function upsertObservation(
  connection: SqlConnection,
  observation: ListingPriceObservation,
): Promise<void> {
  await connection.query(
    upsertObservationSql,
    observationParameters(observation),
  );
}

async function insertLegacyObservation(
  connection: SqlConnection,
  observation: ListingPriceObservation,
): Promise<void> {
  await connection.query(
    `INSERT INTO listing_price_observations (
       address_key,
       listing_key,
       source_listing_id,
       latest_price,
       latest_listed_date,
       latest_last_seen_date,
       comparison_ready,
       observed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (address_key) DO NOTHING`,
    observationParameters(observation),
  );
}

function observationParameters(
  observation: ListingPriceObservation,
): readonly unknown[] {
  return [
    observation.addressKey,
    observation.listingKey,
    observation.sourceListingId,
    observation.latestPrice,
    observation.latestListedDate,
    observation.latestLastSeenDate,
    observation.comparisonReady,
    observation.observedAt,
  ];
}

async function persistEvent(
  connection: SqlConnection,
  event: ListingAlertEvent,
): Promise<void> {
  const result = await connection.query(
    `WITH inserted AS (
       INSERT INTO listing_alert_events (
         event_key,
         listing_key,
         address_key,
         kind,
         formatted_address,
         previous_price,
         current_price,
         status,
         observed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING event_key
     )
     SELECT event_key FROM inserted
     UNION ALL
     SELECT event_key
     FROM listing_alert_events
     WHERE event_key = $1
       AND listing_key = $2
       AND address_key = $3
       AND kind = $4
       AND formatted_address = $5
       AND previous_price IS NOT DISTINCT FROM $6
       AND current_price = $7
       AND observed_at = $8
     LIMIT 1`,
    [
      event.eventKey,
      event.listingKey,
      event.addressKey,
      event.kind,
      event.formattedAddress,
      event.previousPrice,
      event.currentPrice,
      event.observedAt,
    ],
  );

  if (result.rows.length === 0) {
    throw new InvalidListingAlertStateError(
      `Listing alert event ${event.eventKey} is immutable`,
    );
  }
}

function parseLegacyListingRow(value: unknown): LegacyListingRow {
  const row = readRecord(value);
  const listing = parseNormalizedListing(row);
  if (listing.source !== "rentcast") {
    throwInvalidListingRowError();
  }

  const listingKey = readString(row, "deduplication_key");
  const addressKey = createListingAddressKey(listing);
  const observation = listingPriceObservationSchema.parse({
    addressKey,
    listingKey,
    sourceListingId: listing.sourceListingId,
    latestPrice: listing.price,
    latestListedDate: listing.listedDate,
    latestLastSeenDate: listing.lastSeenDate,
    comparisonReady: false,
    observedAt: listing.firstDiscoveredAt,
  });

  return {
    listingKey,
    listing,
    notificationStatus: readLegacyNotificationStatus(row),
    observation,
  };
}

function selectLatestLegacyObservations(
  rows: readonly LegacyListingRow[],
): ListingPriceObservation[] {
  const latestByAddress = new Map<ListingAddressKey, LegacyListingRow>();
  for (const row of rows) {
    const current = latestByAddress.get(row.observation.addressKey);
    if (current === undefined || compareLegacyListingRows(row, current) < 0) {
      latestByAddress.set(row.observation.addressKey, row);
    }
  }

  return [...latestByAddress.values()]
    .sort((first, second) =>
      first.observation.addressKey.localeCompare(second.observation.addressKey),
    )
    .map((row) => row.observation);
}

function compareLegacyListingRows(
  first: LegacyListingRow,
  second: LegacyListingRow,
): number {
  return (
    compareProviderDatesDescending(
      first.listing.lastSeenDate,
      second.listing.lastSeenDate,
    ) ||
    compareProviderDatesDescending(
      first.listing.listedDate,
      second.listing.listedDate,
    ) ||
    compareProviderDatesDescending(
      first.listing.firstDiscoveredAt,
      second.listing.firstDiscoveredAt,
    ) ||
    second.listingKey.localeCompare(first.listingKey)
  );
}

function compareProviderDatesDescending(first: string, second: string): number {
  return Date.parse(second) - Date.parse(first);
}

function createLegacyPendingEvent(row: LegacyListingRow): ListingAlertEvent {
  return listingAlertEventSchema.parse({
    eventKey: createNewListingAlertEventKey({
      addressKey: row.observation.addressKey,
      listingKey: row.listingKey,
      currentPrice: row.listing.price,
      latestLastSeenDate: row.listing.lastSeenDate,
    }),
    listingKey: row.listingKey,
    addressKey: row.observation.addressKey,
    kind: "new-listing",
    formattedAddress: row.listing.formattedAddress,
    previousPrice: null,
    currentPrice: row.listing.price,
    status: "pending",
    observedAt: row.listing.firstDiscoveredAt,
  });
}

function parseObservationRow(value: unknown): ListingPriceObservation {
  const row = readRecord(value);
  return listingPriceObservationSchema.parse({
    addressKey: readString(row, "address_key"),
    listingKey: readString(row, "listing_key"),
    sourceListingId: readString(row, "source_listing_id"),
    latestPrice: readNumber(row, "latest_price"),
    latestListedDate: readString(row, "latest_listed_date"),
    latestLastSeenDate: readString(row, "latest_last_seen_date"),
    comparisonReady: readBoolean(row, "comparison_ready"),
    observedAt: readTimestamp(row, "observed_at"),
  });
}

function parseEventRow(value: unknown): ListingAlertEvent {
  const row = readRecord(value);
  return listingAlertEventSchema.parse({
    eventKey: readString(row, "event_key"),
    listingKey: readString(row, "listing_key"),
    addressKey: readString(row, "address_key"),
    kind: readString(row, "kind"),
    formattedAddress: readString(row, "formatted_address"),
    previousPrice: readNullableNumber(row, "previous_price"),
    currentPrice: readNumber(row, "current_price"),
    status: readString(row, "status"),
    observedAt: readTimestamp(row, "observed_at"),
  });
}

function parseSentEventReference(value: unknown): {
  eventKey: string;
  kind: "new-listing" | "price-drop";
  listingKey: string;
} {
  const row = readRecord(value);
  const kind = readString(row, "kind");
  if (kind !== "new-listing" && kind !== "price-drop") {
    throwInvalidListingAlertRowError();
  }
  return {
    eventKey: readString(row, "event_key"),
    kind,
    listingKey: readString(row, "listing_key"),
  };
}

function readLegacyNotificationStatus(
  row: Record<string, unknown>,
): LegacyListingRow["notificationStatus"] {
  const value = row.notification_status;
  if (value === "baseline" || value === "pending" || value === "sent") {
    return value;
  }
  throwInvalidListingRowError();
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalidListingAlertRowError();
  }
  return value;
}

function readNullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  return row[key] === null ? null : readNumber(row, key);
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throwInvalidListingAlertRowError();
  }
  return value;
}

function readTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  throwInvalidListingAlertRowError();
}

function assertUniqueBaselineAddresses(
  entries: readonly ListingAlertBaselineEntry[],
): void {
  assertUniqueAddresses(entries.map((entry) => entry.observation.addressKey));
}

function assertUniqueTransitionAddresses(
  transitions: readonly ListingAlertTransition[],
): void {
  assertUniqueAddresses(
    transitions.map((transition) => transition.observation.addressKey),
  );
}

function assertUniqueAddresses(addressKeys: readonly ListingAddressKey[]): void {
  if (new Set(addressKeys).size !== addressKeys.length) {
    throw new InvalidListingAlertStateError(
      "A listing alert persistence batch cannot repeat an address",
    );
  }
}

function throwInvalidListingAlertRowError(): never {
  throw new Error(
    "PostgreSQL listing alert row did not match the expected schema",
  );
}
