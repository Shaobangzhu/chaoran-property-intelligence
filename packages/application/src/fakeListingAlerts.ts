import type {
  ListingAddressKey,
  RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  assertValidListingAlertBaselineEntry,
  assertValidListingAlertTransition,
  InvalidListingAlertStateError,
  listingAlertEventSchema,
  type ListingAlertBaselineEntry,
  type ListingAlertEvent,
  type ListingAlertNotificationPort,
  type ListingAlertStateRepositoryPort,
  type ListingAlertTransition,
  type ListingPriceObservation,
} from "./listingAlertContracts.js";

export type FakeListingAlertStateRepositoryMethod =
  | "isPriceObservationBaselineInitialized"
  | "initializePriceObservationBaseline"
  | "findPriceObservations"
  | "saveListingAlertTransitions"
  | "findPendingListingAlertEvents"
  | "markListingAlertEventsSent";

export type FakeListingAlertStateRepositoryCall =
  | { method: "isPriceObservationBaselineInitialized" }
  | {
      method: "initializePriceObservationBaseline";
      entries: ListingAlertBaselineEntry[];
    }
  | {
      method: "findPriceObservations";
      addressKeys: ListingAddressKey[];
    }
  | {
      method: "saveListingAlertTransitions";
      transitions: ListingAlertTransition[];
    }
  | { method: "findPendingListingAlertEvents" }
  | {
      method: "markListingAlertEventsSent";
      eventKeys: string[];
    };

export interface FakeListingAlertStateRepositoryOptions {
  baselineInitialized?: boolean;
  baselineEntries?: readonly ListingAlertBaselineEntry[];
  events?: readonly ListingAlertEvent[];
  failures?: Partial<Record<FakeListingAlertStateRepositoryMethod, Error>>;
}

export class FakeListingAlertStateRepository
  implements ListingAlertStateRepositoryPort
{
  readonly calls: FakeListingAlertStateRepositoryCall[] = [];

  private baselineInitialized: boolean;
  private readonly observationsByAddress = new Map<
    ListingAddressKey,
    ListingPriceObservation
  >();
  private readonly listingsByKey = new Map<string, RentCastNormalizedListing>();
  private readonly eventsByKey = new Map<string, ListingAlertEvent>();
  private readonly failures: Partial<
    Record<FakeListingAlertStateRepositoryMethod, Error>
  >;

  constructor(options: FakeListingAlertStateRepositoryOptions = {}) {
    this.baselineInitialized =
      options.baselineInitialized ?? options.baselineEntries !== undefined;
    this.failures = options.failures ?? {};

    for (const entry of options.baselineEntries ?? []) {
      this.storeBaselineEntry(entry);
    }
    for (const event of options.events ?? []) {
      const parsedEvent = listingAlertEventSchema.parse(event);
      this.assertEventIsImmutable(parsedEvent, this.eventsByKey);
      const existing = this.eventsByKey.get(parsedEvent.eventKey);
      if (existing === undefined || parsedEvent.status === "sent") {
        this.eventsByKey.set(parsedEvent.eventKey, cloneEvent(parsedEvent));
      }
    }
  }

  get observations(): ListingPriceObservation[] {
    return [...this.observationsByAddress.values()]
      .sort(compareObservations)
      .map(cloneObservation);
  }

  get events(): ListingAlertEvent[] {
    return [...this.eventsByKey.values()].sort(compareEvents).map(cloneEvent);
  }

  get listingSnapshots(): RentCastNormalizedListing[] {
    return [...this.listingsByKey.entries()]
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([, listing]) => cloneListing(listing));
  }

  async isPriceObservationBaselineInitialized(): Promise<boolean> {
    this.calls.push({ method: "isPriceObservationBaselineInitialized" });
    this.throwConfiguredFailure("isPriceObservationBaselineInitialized");
    return this.baselineInitialized;
  }

  async initializePriceObservationBaseline(
    entries: readonly ListingAlertBaselineEntry[],
  ): Promise<void> {
    const clonedEntries = entries.map(cloneBaselineEntry);
    this.calls.push({
      method: "initializePriceObservationBaseline",
      entries: clonedEntries,
    });
    this.throwConfiguredFailure("initializePriceObservationBaseline");

    for (const entry of clonedEntries) {
      assertValidListingAlertBaselineEntry(entry);
    }
    for (const entry of clonedEntries) {
      this.storeBaselineEntry(entry);
    }
    this.baselineInitialized = true;
  }

  async findPriceObservations(
    addressKeys: readonly ListingAddressKey[],
  ): Promise<ListingPriceObservation[]> {
    this.calls.push({
      method: "findPriceObservations",
      addressKeys: [...addressKeys],
    });
    this.throwConfiguredFailure("findPriceObservations");

    const seen = new Set<ListingAddressKey>();
    const observations: ListingPriceObservation[] = [];
    for (const addressKey of addressKeys) {
      if (seen.has(addressKey)) {
        continue;
      }
      seen.add(addressKey);
      const observation = this.observationsByAddress.get(addressKey);
      if (observation !== undefined) {
        observations.push(cloneObservation(observation));
      }
    }
    return observations;
  }

  async saveListingAlertTransitions(
    transitions: readonly ListingAlertTransition[],
  ): Promise<void> {
    const clonedTransitions = transitions.map(cloneTransition);
    this.calls.push({
      method: "saveListingAlertTransitions",
      transitions: clonedTransitions,
    });
    this.throwConfiguredFailure("saveListingAlertTransitions");

    const prospectiveEvents = new Map(this.eventsByKey);
    for (const transition of clonedTransitions) {
      assertValidListingAlertTransition(transition);
      this.assertEventIsImmutable(transition.event, prospectiveEvents);
      if (transition.event !== null) {
        prospectiveEvents.set(transition.event.eventKey, transition.event);
      }
    }

    for (const transition of clonedTransitions) {
      this.observationsByAddress.set(
        transition.observation.addressKey,
        cloneObservation(transition.observation),
      );
      this.listingsByKey.set(
        transition.observation.listingKey,
        cloneListing(transition.listing),
      );
      if (transition.event !== null) {
        const existing = this.eventsByKey.get(transition.event.eventKey);
        if (existing === undefined) {
          this.eventsByKey.set(
            transition.event.eventKey,
            cloneEvent(transition.event),
          );
        }
      }
    }
  }

  async findPendingListingAlertEvents(): Promise<ListingAlertEvent[]> {
    this.calls.push({ method: "findPendingListingAlertEvents" });
    this.throwConfiguredFailure("findPendingListingAlertEvents");
    return this.events
      .filter((event) => event.status === "pending")
      .map(cloneEvent);
  }

  async markListingAlertEventsSent(
    eventKeys: readonly string[],
  ): Promise<void> {
    this.calls.push({
      method: "markListingAlertEventsSent",
      eventKeys: [...eventKeys],
    });
    this.throwConfiguredFailure("markListingAlertEventsSent");

    for (const eventKey of eventKeys) {
      const event = this.eventsByKey.get(eventKey);
      if (event !== undefined) {
        this.eventsByKey.set(eventKey, { ...event, status: "sent" });
      }
    }
  }

  private storeBaselineEntry(entry: ListingAlertBaselineEntry): void {
    assertValidListingAlertBaselineEntry(entry);
    this.observationsByAddress.set(
      entry.observation.addressKey,
      cloneObservation(entry.observation),
    );
    this.listingsByKey.set(
      entry.observation.listingKey,
      cloneListing(entry.listing),
    );
  }

  private assertEventIsImmutable(
    event: ListingAlertEvent | null,
    eventsByKey: ReadonlyMap<string, ListingAlertEvent>,
  ): void {
    if (event === null) {
      return;
    }

    const existing = eventsByKey.get(event.eventKey);
    if (existing !== undefined && !eventsEqual(existing, event)) {
      throw new InvalidListingAlertStateError(
        `Listing alert event ${event.eventKey} is immutable`,
      );
    }
  }

  private throwConfiguredFailure(
    method: FakeListingAlertStateRepositoryMethod,
  ): void {
    const error = this.failures[method];
    if (error !== undefined) {
      throw error;
    }
  }
}

export interface FakeListingAlertNotificationsOptions {
  failure?: Error;
}

export class FakeListingAlertNotifications
  implements ListingAlertNotificationPort
{
  readonly calls: ListingAlertEvent[][] = [];

  constructor(
    private readonly options: FakeListingAlertNotificationsOptions = {},
  ) {}

  async sendListingAlerts(
    events: readonly ListingAlertEvent[],
  ): Promise<void> {
    const parsedEvents = events.map((event) =>
      cloneEvent(listingAlertEventSchema.parse(event)),
    );
    this.calls.push(parsedEvents);

    if (this.options.failure !== undefined) {
      throw this.options.failure;
    }
  }
}

function cloneBaselineEntry(
  entry: ListingAlertBaselineEntry,
): ListingAlertBaselineEntry {
  return {
    listing: cloneListing(entry.listing),
    observation: cloneObservation(entry.observation),
  };
}

function cloneTransition(
  transition: ListingAlertTransition,
): ListingAlertTransition {
  return {
    ...cloneBaselineEntry(transition),
    event: transition.event === null ? null : cloneEvent(transition.event),
  };
}

function cloneListing(
  listing: RentCastNormalizedListing,
): RentCastNormalizedListing {
  return { ...listing };
}

function cloneObservation(
  observation: ListingPriceObservation,
): ListingPriceObservation {
  return { ...observation };
}

function cloneEvent(event: ListingAlertEvent): ListingAlertEvent {
  return { ...event };
}

function compareObservations(
  first: ListingPriceObservation,
  second: ListingPriceObservation,
): number {
  return (
    first.observedAt.localeCompare(second.observedAt) ||
    first.addressKey.localeCompare(second.addressKey)
  );
}

function compareEvents(
  first: ListingAlertEvent,
  second: ListingAlertEvent,
): number {
  return (
    first.observedAt.localeCompare(second.observedAt) ||
    first.eventKey.localeCompare(second.eventKey)
  );
}

function eventsEqual(
  first: ListingAlertEvent,
  second: ListingAlertEvent,
): boolean {
  return (
    first.eventKey === second.eventKey &&
    first.listingKey === second.listingKey &&
    first.addressKey === second.addressKey &&
    first.kind === second.kind &&
    first.formattedAddress === second.formattedAddress &&
    first.previousPrice === second.previousPrice &&
    first.currentPrice === second.currentPrice &&
    first.observedAt === second.observedAt
  );
}
