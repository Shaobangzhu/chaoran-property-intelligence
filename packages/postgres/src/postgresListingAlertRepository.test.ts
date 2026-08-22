import { describe, expect, it } from "vitest";

import {
  createListingKey,
  ListingAlertObservationConflictError,
  type ListingAlertEvent,
  type ListingAlertTransition,
  type ListingPriceObservation,
} from "@chaoran-property-intelligence/application";
import {
  createListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import { PostgresListingAlertRepository } from "./postgresListingAlertRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

describe("PostgresListingAlertRepository", () => {
  it("initializes listing snapshots, observations, and the marker atomically", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresListingAlertRepository(database);
    const listing = createListing();
    const observation = createObservation(listing, {
      observedAt: "2026-08-21T15:00:00.000Z",
    });

    await repository.initializePriceObservationBaseline([
      { listing, observation },
    ]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.text).toContain("pg_advisory_xact_lock");
    expect(database.queries[1]?.parameters).toEqual([
      "price_observation_baseline_initialized",
    ]);
    expect(database.queries[2]?.text).toContain("INSERT INTO listings");
    expect(database.queries[2]?.text).toContain(
      "ON CONFLICT (deduplication_key) DO UPDATE",
    );
    expect(database.queries[2]?.text).not.toContain(
      "first_discovered_at = EXCLUDED.first_discovered_at",
    );
    expect(database.queries[3]?.parameters).toEqual([
      observation.addressKey,
      observation.listingKey,
      observation.sourceListingId,
      825000,
      listing.listedDate,
      listing.lastSeenDate,
      true,
      "2026-08-21T15:00:00.000Z",
    ]);
    expect(database.queries[4]?.parameters).toEqual([
      "price_observation_baseline_initialized",
    ]);
  });

  it("does not create the new marker when no legacy baseline exists", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await repository.initializeLegacyListingAlertState();

    expect(database.transactionCount).toBe(1);
    expect(database.queries).toHaveLength(3);
    expect(database.queries[2]?.parameters).toEqual(["baseline_initialized"]);
    expect(
      database.queries.some((query) =>
        query.text.includes("INSERT INTO alert_worker_state"),
      ),
    ).toBe(false);
  });

  it("backfills one non-comparable observation per address and preserves legacy pending work", async () => {
    const oldListing = createListing({
      sourceListingId: "rentcast-old",
      mlsNumber: "PW26180000",
      listedDate: "2026-08-18T00:00:00.000Z",
      lastSeenDate: "2026-08-20T12:00:00.000Z",
      firstDiscoveredAt: "2026-08-20T13:00:00.000Z",
      price: 835000,
    });
    const pendingListing = createListing({
      lastSeenDate: "2026-08-21T12:00:00.000Z",
      firstDiscoveredAt: "2026-08-21T13:00:00.000Z",
      price: 825000,
    });
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [] },
      { rows: [{ state_key: "baseline_initialized" }] },
      {
        rows: [
          createLegacyListingRow(oldListing, "baseline"),
          createLegacyListingRow(pendingListing, "pending"),
        ],
      },
      { rows: [] },
      { rows: [{ event_key: "preserved-pending-event" }] },
      { rows: [] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await repository.initializeLegacyListingAlertState();

    expect(database.queries).toHaveLength(7);
    expect(database.queries[4]?.text).toContain(
      "INSERT INTO listing_price_observations",
    );
    expect(database.queries[4]?.parameters.slice(0, 4)).toEqual([
      createListingAddressKey(pendingListing),
      createListingKey(pendingListing),
      pendingListing.sourceListingId,
      825000,
    ]);
    expect(database.queries[4]?.parameters[6]).toBe(false);
    expect(database.queries[5]?.text).toContain(
      "INSERT INTO listing_alert_events",
    );
    expect(database.queries[5]?.parameters.slice(0, 7)).toEqual([
      expect.stringContaining("listing-alert:v1:new-listing"),
      createListingKey(pendingListing),
      createListingAddressKey(pendingListing),
      "new-listing",
      pendingListing.formattedAddress,
      null,
      825000,
    ]);
    expect(database.queries[6]?.parameters).toEqual([
      "price_observation_baseline_initialized",
    ]);
  });

  it("locks and compare-and-swaps an observation before persisting its event", async () => {
    const transition = createPriceDropTransition();
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [createObservationRow(transition.expectedPreviousObservation!)] },
      { rows: [] },
      { rows: [] },
      { rows: [{ event_key: transition.event!.eventKey }] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await repository.saveListingAlertTransitions([transition]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.parameters).toEqual([
      `cpi:listing-alert:${transition.observation.addressKey}`,
    ]);
    expect(database.queries[1]?.text).toContain("FOR UPDATE");
    expect(database.queries[1]?.parameters).toEqual([
      [transition.observation.addressKey],
    ]);
    expect(database.queries[2]?.parameters).toContain(810000);
    expect(database.queries[3]?.parameters[6]).toBe(true);
    expect(database.queries[4]?.text).toContain("ON CONFLICT (event_key) DO NOTHING");
  });

  it("rejects stale state before any listing, observation, or event write", async () => {
    const transition = createPriceDropTransition();
    const staleCurrent = {
      ...transition.expectedPreviousObservation!,
      latestPrice: 820000,
    };
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [createObservationRow(staleCurrent)] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await expect(
      repository.saveListingAlertTransitions([transition]),
    ).rejects.toThrow(ListingAlertObservationConflictError);

    expect(database.queries).toHaveLength(2);
  });

  it("maps pending events in stable delivery order", async () => {
    const event = createPriceDropTransition().event!;
    const database = new RecordingSqlDatabase([
      { rows: [createEventRow(event)] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await expect(repository.findPendingListingAlertEvents()).resolves.toEqual([
      event,
    ]);
    expect(database.queries[0]?.text).toContain(
      "ORDER BY observed_at, event_key",
    );
  });

  it("marks only returned new-listing snapshots sent for legacy compatibility", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [
          {
            event_key: "new-event",
            kind: "new-listing",
            listing_key: "listing-new",
          },
          {
            event_key: "drop-event",
            kind: "price-drop",
            listing_key: "listing-existing",
          },
        ],
      },
      { rows: [] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await repository.markListingAlertEventsSent([
      "new-event",
      "drop-event",
      "missing-event",
    ]);

    expect(database.transactionCount).toBe(1);
    expect(database.queries[0]?.text).toContain(
      "UPDATE listing_alert_events",
    );
    expect(database.queries[1]?.parameters).toEqual([["listing-new"]]);
    expect(database.queries[1]?.text).toContain(
      "notification_status = 'sent'",
    );
  });

  it("refuses an event-key collision with a different immutable payload", async () => {
    const transition = createPriceDropTransition();
    const database = new RecordingSqlDatabase([
      { rows: [] },
      { rows: [createObservationRow(transition.expectedPreviousObservation!)] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresListingAlertRepository(database);

    await expect(
      repository.saveListingAlertTransitions([transition]),
    ).rejects.toThrow("is immutable");
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  transactionCount = 0;

  constructor(private readonly responses: SqlQueryResult[] = []) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createListing(
  overrides: Partial<RentCastNormalizedListing> = {},
): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "rentcast-3420",
    mlsName: "CRMLS",
    mlsNumber: "PW26181310",
    formattedAddress: "3420 New York Dr, Corona, CA 92882",
    addressLine1: "3420 New York Dr",
    addressLine2: null,
    city: "Corona",
    state: "CA",
    zipCode: "92882",
    latitude: 33.8753,
    longitude: -117.5664,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825000,
    status: "Active",
    listedDate: "2026-08-19T00:00:00.000Z",
    lastSeenDate: "2026-08-21T12:00:00.000Z",
    firstDiscoveredAt: "2026-08-19T13:00:00.000Z",
    ...overrides,
  };
}

function createObservation(
  listing: RentCastNormalizedListing,
  overrides: Partial<ListingPriceObservation> = {},
): ListingPriceObservation {
  return {
    addressKey: createListingAddressKey(listing),
    listingKey: createListingKey(listing),
    sourceListingId: listing.sourceListingId,
    latestPrice: listing.price,
    latestListedDate: listing.listedDate,
    latestLastSeenDate: listing.lastSeenDate,
    comparisonReady: true,
    observedAt: "2026-08-20T15:00:00.000Z",
    ...overrides,
  };
}

function createPriceDropTransition(): ListingAlertTransition {
  const previousListing = createListing();
  const currentListing = createListing({
    price: 810000,
    lastSeenDate: "2026-08-22T12:00:00.000Z",
  });
  const previous = createObservation(previousListing);
  const observation = createObservation(currentListing, {
    observedAt: "2026-08-22T15:00:00.000Z",
  });
  const event: ListingAlertEvent = {
    eventKey: "listing-alert:v1:price-drop:test",
    listingKey: observation.listingKey,
    addressKey: observation.addressKey,
    kind: "price-drop",
    formattedAddress: currentListing.formattedAddress,
    previousPrice: 825000,
    currentPrice: 810000,
    status: "pending",
    observedAt: observation.observedAt,
  };

  return {
    listing: currentListing,
    observation,
    expectedPreviousObservation: previous,
    event,
  };
}

function createObservationRow(
  observation: ListingPriceObservation,
): Record<string, unknown> {
  return {
    address_key: observation.addressKey,
    listing_key: observation.listingKey,
    source_listing_id: observation.sourceListingId,
    latest_price: observation.latestPrice,
    latest_listed_date: observation.latestListedDate,
    latest_last_seen_date: observation.latestLastSeenDate,
    comparison_ready: observation.comparisonReady,
    observed_at: new Date(observation.observedAt),
  };
}

function createEventRow(event: ListingAlertEvent): Record<string, unknown> {
  return {
    event_key: event.eventKey,
    listing_key: event.listingKey,
    address_key: event.addressKey,
    kind: event.kind,
    formatted_address: event.formattedAddress,
    previous_price: event.previousPrice,
    current_price: event.currentPrice,
    status: event.status,
    observed_at: new Date(event.observedAt),
  };
}

function createLegacyListingRow(
  listing: RentCastNormalizedListing,
  notificationStatus: "baseline" | "pending" | "sent",
): Record<string, unknown> {
  return {
    deduplication_key: createListingKey(listing),
    source: listing.source,
    source_listing_id: listing.sourceListingId,
    mls_name: listing.mlsName,
    mls_number: listing.mlsNumber,
    formatted_address: listing.formattedAddress,
    address_line_1: listing.addressLine1,
    address_line_2: listing.addressLine2,
    city: listing.city,
    state: listing.state,
    zip_code: listing.zipCode,
    latitude: listing.latitude,
    longitude: listing.longitude,
    property_type: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    price: listing.price,
    status: listing.status,
    listed_date: listing.listedDate,
    last_seen_date: listing.lastSeenDate,
    first_discovered_at: listing.firstDiscoveredAt,
    notification_status: notificationStatus,
  };
}
