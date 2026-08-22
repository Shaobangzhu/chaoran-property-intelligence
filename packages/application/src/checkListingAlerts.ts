import {
  createListingAddressKey,
  type ListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import type { ListingSourcePort } from "./checkNewListings.js";
import {
  type ListingAlertBaselineEntry,
  type ListingAlertEvent,
  type ListingAlertNotificationPort,
  type ListingAlertStateRepositoryPort,
  type ListingAlertTransition,
  type ListingPriceObservation,
} from "./listingAlertContracts.js";
import {
  createNewListingAlertEventKey,
  createPriceDropListingAlertEventKey,
} from "./listingAlertIdentity.js";
import { createListingKey } from "./listingIdentity.js";

export interface ListingAlertCriteriaPort {
  matchesAcquisitionCriteria(listing: RentCastNormalizedListing): boolean;
  matchesNewListingCriteria(listing: RentCastNormalizedListing): boolean;
}

export interface CheckListingAlertsOptions {
  source: ListingSourcePort;
  repository: ListingAlertStateRepositoryPort;
  notifications: ListingAlertNotificationPort;
  criteria: ListingAlertCriteriaPort;
  now: () => Date;
}

export class InvalidListingAlertClockError extends Error {
  constructor() {
    super("Listing alert clock returned an invalid date");
    this.name = "InvalidListingAlertClockError";
  }
}

export class AmbiguousListingAddressObservationError extends Error {
  constructor() {
    super("Provider returned conflicting listings for one canonical address");
    this.name = "AmbiguousListingAddressObservationError";
  }
}

export class CheckListingAlerts {
  private readonly source: ListingSourcePort;
  private readonly repository: ListingAlertStateRepositoryPort;
  private readonly notifications: ListingAlertNotificationPort;
  private readonly criteria: ListingAlertCriteriaPort;
  private readonly now: () => Date;

  constructor(options: CheckListingAlertsOptions) {
    this.source = options.source;
    this.repository = options.repository;
    this.notifications = options.notifications;
    this.criteria = options.criteria;
    this.now = options.now;
  }

  async execute(): Promise<void> {
    const sourceListings = await this.source.getActiveSaleListings();
    const candidates = prepareUniqueCandidates(
      sourceListings.filter((listing) =>
        this.criteria.matchesAcquisitionCriteria(listing),
      ),
    );

    const baselineInitialized =
      await this.repository.isPriceObservationBaselineInitialized();

    if (!baselineInitialized) {
      const baselineCandidates = candidates.filter(({ listing }) =>
        this.criteria.matchesNewListingCriteria(listing),
      );
      const observedAt =
        baselineCandidates.length === 0 ? null : readObservedAt(this.now);
      const entries = baselineCandidates.map((candidate) =>
        createBaselineEntry(candidate, observedAt!),
      );

      await this.repository.initializePriceObservationBaseline(entries);
      return;
    }

    const previousObservations = await this.repository.findPriceObservations(
      candidates.map((candidate) => candidate.addressKey),
    );
    const previousByAddress = new Map(
      previousObservations.map((observation) => [
        observation.addressKey,
        observation,
      ]),
    );
    const actionableCandidates = candidates
      .map((candidate) => ({
        candidate,
        previous: previousByAddress.get(candidate.addressKey),
        isNewListingEligible: this.criteria.matchesNewListingCriteria(
          candidate.listing,
        ),
      }))
      .filter(
        ({ previous, isNewListingEligible }) =>
          previous !== undefined || isNewListingEligible,
      );
    const observedAt =
      actionableCandidates.length === 0 ? null : readObservedAt(this.now);
    const transitions = actionableCandidates.map(
      ({ candidate, previous, isNewListingEligible }) =>
        createTransition(
          candidate,
          previous,
          isNewListingEligible,
          observedAt!,
        ),
    );

    if (transitions.length > 0) {
      await this.repository.saveListingAlertTransitions(transitions);
    }

    const pendingEvents =
      await this.repository.findPendingListingAlertEvents();
    if (pendingEvents.length === 0) {
      return;
    }

    await this.notifications.sendListingAlerts(pendingEvents);
    await this.repository.markListingAlertEventsSent(
      pendingEvents.map((event) => event.eventKey),
    );
  }
}

interface PreparedListingCandidate {
  listing: RentCastNormalizedListing;
  addressKey: ListingAddressKey;
  listingKey: string;
}

function prepareUniqueCandidates(
  listings: readonly RentCastNormalizedListing[],
): PreparedListingCandidate[] {
  const candidatesByAddress = new Map<
    ListingAddressKey,
    PreparedListingCandidate
  >();

  for (const listing of listings) {
    const candidate = {
      listing,
      addressKey: createListingAddressKey(listing),
      listingKey: createListingKey(listing),
    };
    const existing = candidatesByAddress.get(candidate.addressKey);

    if (existing === undefined) {
      candidatesByAddress.set(candidate.addressKey, candidate);
      continue;
    }

    if (!listingsAreEquivalent(existing.listing, listing)) {
      throw new AmbiguousListingAddressObservationError();
    }
  }

  return [...candidatesByAddress.values()];
}

function createBaselineEntry(
  candidate: PreparedListingCandidate,
  observedAt: string,
): ListingAlertBaselineEntry {
  return {
    listing: candidate.listing,
    observation: createObservation(candidate, observedAt),
  };
}

function createTransition(
  candidate: PreparedListingCandidate,
  previous: ListingPriceObservation | undefined,
  isNewListingEligible: boolean,
  observedAt: string,
): ListingAlertTransition {
  const observation = createObservation(candidate, observedAt);
  let event: ListingAlertEvent | null = null;

  if (
    previous === undefined ||
    (previous.listingKey !== candidate.listingKey && isNewListingEligible)
  ) {
    event = createNewListingEvent(candidate, observedAt);
  } else if (candidate.listing.price < previous.latestPrice) {
    event = previous.comparisonReady
      ? createPriceDropEvent(candidate, previous, observedAt)
      : null;
  }

  return {
    listing: candidate.listing,
    observation,
    expectedPreviousObservation: previous ?? null,
    event,
  };
}

function createObservation(
  candidate: PreparedListingCandidate,
  observedAt: string,
): ListingPriceObservation {
  return {
    addressKey: candidate.addressKey,
    listingKey: candidate.listingKey,
    sourceListingId: candidate.listing.sourceListingId,
    latestPrice: candidate.listing.price,
    latestListedDate: candidate.listing.listedDate,
    latestLastSeenDate: candidate.listing.lastSeenDate,
    comparisonReady: true,
    observedAt,
  };
}

function createNewListingEvent(
  candidate: PreparedListingCandidate,
  observedAt: string,
): ListingAlertEvent {
  return {
    eventKey: createNewListingAlertEventKey({
      addressKey: candidate.addressKey,
      listingKey: candidate.listingKey,
      currentPrice: candidate.listing.price,
      latestLastSeenDate: candidate.listing.lastSeenDate,
    }),
    listingKey: candidate.listingKey,
    addressKey: candidate.addressKey,
    kind: "new-listing",
    formattedAddress: candidate.listing.formattedAddress,
    previousPrice: null,
    currentPrice: candidate.listing.price,
    status: "pending",
    observedAt,
  };
}

function createPriceDropEvent(
  candidate: PreparedListingCandidate,
  previous: ListingPriceObservation,
  observedAt: string,
): ListingAlertEvent {
  return {
    eventKey: createPriceDropListingAlertEventKey({
      addressKey: candidate.addressKey,
      listingKey: candidate.listingKey,
      previousPrice: previous.latestPrice,
      currentPrice: candidate.listing.price,
      previousObservedAt: previous.observedAt,
      latestLastSeenDate: candidate.listing.lastSeenDate,
    }),
    listingKey: candidate.listingKey,
    addressKey: candidate.addressKey,
    kind: "price-drop",
    formattedAddress: candidate.listing.formattedAddress,
    previousPrice: previous.latestPrice,
    currentPrice: candidate.listing.price,
    status: "pending",
    observedAt,
  };
}

function readObservedAt(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidListingAlertClockError();
  }
  return value.toISOString();
}

function listingsAreEquivalent(
  first: RentCastNormalizedListing,
  second: RentCastNormalizedListing,
): boolean {
  return (
    first.source === second.source &&
    first.sourceListingId === second.sourceListingId &&
    first.mlsName === second.mlsName &&
    first.mlsNumber === second.mlsNumber &&
    first.formattedAddress === second.formattedAddress &&
    first.addressLine1 === second.addressLine1 &&
    first.addressLine2 === second.addressLine2 &&
    first.city === second.city &&
    first.state === second.state &&
    first.zipCode === second.zipCode &&
    first.latitude === second.latitude &&
    first.longitude === second.longitude &&
    first.propertyType === second.propertyType &&
    first.bedrooms === second.bedrooms &&
    first.bathrooms === second.bathrooms &&
    first.price === second.price &&
    first.status === second.status &&
    first.listedDate === second.listedDate &&
    first.lastSeenDate === second.lastSeenDate &&
    first.firstDiscoveredAt === second.firstDiscoveredAt
  );
}
