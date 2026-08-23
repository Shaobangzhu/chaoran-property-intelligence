import {
  createListingAddressKey,
  isListingAddressKey,
  type ListingAddressKey,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";
import { z } from "zod";

export const LISTING_ALERT_LIMITS = Object.freeze({
  eventKey: 1_024,
  listingKey: 512,
  sourceListingId: 256,
  formattedAddress: 512,
});

export const listingAlertKindSchema = z.enum(["new-listing", "price-drop"]);
export const listingAlertStatusSchema = z.enum(["pending", "sent"]);

const addressKeySchema = z.custom<ListingAddressKey>(isListingAddressKey, {
  message: "Invalid canonical listing address key",
});
const timestampSchema = z.iso.datetime({ offset: true });
const providerDateSchema = z.union([z.iso.date(), timestampSchema]);
const positiveWholeDollarSchema = z.number().int().positive().safe();
const eventKeySchema = boundedString(LISTING_ALERT_LIMITS.eventKey);
const listingKeySchema = boundedString(LISTING_ALERT_LIMITS.listingKey);

export const listingPriceObservationSchema = z.strictObject({
  addressKey: addressKeySchema,
  listingKey: listingKeySchema,
  sourceListingId: boundedString(LISTING_ALERT_LIMITS.sourceListingId),
  latestPrice: positiveWholeDollarSchema,
  latestListedDate: providerDateSchema,
  latestLastSeenDate: providerDateSchema,
  comparisonReady: z.boolean(),
  observedAt: timestampSchema,
});

const listingAlertEventBaseShape = {
  eventKey: eventKeySchema,
  listingKey: listingKeySchema,
  addressKey: addressKeySchema,
  formattedAddress: boundedString(LISTING_ALERT_LIMITS.formattedAddress),
  currentPrice: positiveWholeDollarSchema,
  status: listingAlertStatusSchema,
  observedAt: timestampSchema,
};

export const listingAlertEventSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...listingAlertEventBaseShape,
      kind: z.literal("new-listing"),
      previousPrice: z.null(),
    }),
    z.strictObject({
      ...listingAlertEventBaseShape,
      kind: z.literal("price-drop"),
      previousPrice: positiveWholeDollarSchema,
    }),
  ])
  .superRefine((event, context) => {
    if (
      event.kind === "price-drop" &&
      event.previousPrice <= event.currentPrice
    ) {
      context.addIssue({
        code: "custom",
        message: "Price-drop previous price must exceed current price",
        path: ["previousPrice"],
      });
    }
  });

export type ListingAlertKind = z.infer<typeof listingAlertKindSchema>;
export type ListingAlertStatus = z.infer<typeof listingAlertStatusSchema>;
export type ListingPriceObservation = z.infer<
  typeof listingPriceObservationSchema
>;
export type ListingAlertEvent = z.infer<typeof listingAlertEventSchema>;

export interface ListingAlertBaselineEntry {
  listing: RentCastNormalizedListing;
  observation: ListingPriceObservation;
}

export interface ListingAlertTransition extends ListingAlertBaselineEntry {
  expectedPreviousObservation: ListingPriceObservation | null;
  event: ListingAlertEvent | null;
}

export interface ListingSearchRevisionBaselineCandidate
  extends ListingAlertBaselineEntry {
  isNewListingEligible: boolean;
}

export interface ApplyListingSearchRevisionBaselineInput {
  expectedRevision: number;
  expectedAppliedRevision: number;
  candidates: readonly ListingSearchRevisionBaselineCandidate[];
}

export type ApplyListingSearchRevisionBaselineResult =
  | { readonly status: "applied" }
  | { readonly status: "already-applied" }
  | { readonly status: "conflict" };

export interface ListingSearchRevisionBaselineRepositoryPort {
  applyListingSearchRevisionBaseline(
    input: ApplyListingSearchRevisionBaselineInput,
  ): Promise<ApplyListingSearchRevisionBaselineResult>;
}

export interface ListingAlertStateRepositoryPort {
  isPriceObservationBaselineInitialized(): Promise<boolean>;
  initializePriceObservationBaseline(
    entries: readonly ListingAlertBaselineEntry[],
  ): Promise<void>;
  findPriceObservations(
    addressKeys: readonly ListingAddressKey[],
  ): Promise<ListingPriceObservation[]>;
  saveListingAlertTransitions(
    transitions: readonly ListingAlertTransition[],
  ): Promise<void>;
  findPendingListingAlertEvents(): Promise<ListingAlertEvent[]>;
  markListingAlertEventsSent(eventKeys: readonly string[]): Promise<void>;
}

export interface ListingAlertNotificationPort {
  sendListingAlerts(events: readonly ListingAlertEvent[]): Promise<void>;
}

export class InvalidListingAlertStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListingAlertStateError";
  }
}

export class ListingAlertObservationConflictError extends Error {
  constructor(addressKey: ListingAddressKey) {
    super(`Listing alert observation changed concurrently for ${addressKey}`);
    this.name = "ListingAlertObservationConflictError";
  }
}

export class InvalidListingSearchRevisionBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListingSearchRevisionBaselineError";
  }
}

export function safeParseListingPriceObservation(value: unknown) {
  return listingPriceObservationSchema.safeParse(value);
}

export function safeParseListingAlertEvent(value: unknown) {
  return listingAlertEventSchema.safeParse(value);
}

export function assertValidListingAlertBaselineEntry(
  entry: ListingAlertBaselineEntry,
): void {
  const observationResult = listingPriceObservationSchema.safeParse(
    entry.observation,
  );
  if (!observationResult.success) {
    throw new InvalidListingAlertStateError(
      `Invalid price observation: ${observationResult.error.message}`,
    );
  }

  assertListingMatchesObservation(entry.listing, observationResult.data);

  if (!observationResult.data.comparisonReady) {
    throw new InvalidListingAlertStateError(
      "A new price-observation baseline must be comparison ready",
    );
  }
}

export function assertValidListingSearchRevisionBaselineInput(
  input: ApplyListingSearchRevisionBaselineInput,
): void {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !Number.isSafeInteger(input.expectedAppliedRevision) ||
    input.expectedAppliedRevision < 1 ||
    input.expectedAppliedRevision >= input.expectedRevision
  ) {
    throw new InvalidListingSearchRevisionBaselineError(
      "Listing search revision baseline versions were invalid",
    );
  }

  const seenAddresses = new Set<ListingAddressKey>();
  for (const candidate of input.candidates) {
    assertValidListingAlertBaselineEntry(candidate);
    if (typeof candidate.isNewListingEligible !== "boolean") {
      throw new InvalidListingSearchRevisionBaselineError(
        "Listing search revision baseline eligibility was invalid",
      );
    }
    if (seenAddresses.has(candidate.observation.addressKey)) {
      throw new InvalidListingSearchRevisionBaselineError(
        "Listing search revision baseline cannot repeat an address",
      );
    }
    seenAddresses.add(candidate.observation.addressKey);
  }
}

export function assertValidListingAlertTransition(
  transition: ListingAlertTransition,
): void {
  assertValidListingAlertBaselineEntry(transition);

  const previous = parseExpectedPreviousObservation(
    transition.expectedPreviousObservation,
  );
  if (
    previous !== null &&
    previous.addressKey !== transition.observation.addressKey
  ) {
    throw new InvalidListingAlertStateError(
      "Previous and latest observation address keys must match",
    );
  }

  if (transition.event === null) {
    return;
  }

  const eventResult = listingAlertEventSchema.safeParse(transition.event);
  if (!eventResult.success) {
    throw new InvalidListingAlertStateError(
      `Invalid listing alert event: ${eventResult.error.message}`,
    );
  }

  const event = eventResult.data;
  const observation = transition.observation;
  const listing = transition.listing;

  if (event.status !== "pending") {
    throw new InvalidListingAlertStateError(
      "A newly persisted listing alert event must be pending",
    );
  }
  if (event.addressKey !== observation.addressKey) {
    throw new InvalidListingAlertStateError(
      "Event and observation address keys must match",
    );
  }
  if (event.listingKey !== observation.listingKey) {
    throw new InvalidListingAlertStateError(
      "Event and observation listing keys must match",
    );
  }
  if (event.currentPrice !== observation.latestPrice) {
    throw new InvalidListingAlertStateError(
      "Event current price must match the latest observation",
    );
  }
  if (event.observedAt !== observation.observedAt) {
    throw new InvalidListingAlertStateError(
      "Event and observation timestamps must match",
    );
  }
  if (event.formattedAddress !== listing.formattedAddress) {
    throw new InvalidListingAlertStateError(
      "Event address snapshot must match the observed listing",
    );
  }
  if (
    event.kind === "new-listing" &&
    previous !== null &&
    previous.listingKey === observation.listingKey
  ) {
    throw new InvalidListingAlertStateError(
      "A new-listing event cannot repeat the same listing identity",
    );
  }
  if (event.kind === "price-drop") {
    if (previous === null || !previous.comparisonReady) {
      throw new InvalidListingAlertStateError(
        "A price-drop event requires a comparison-ready previous observation",
      );
    }
    if (event.previousPrice !== previous.latestPrice) {
      throw new InvalidListingAlertStateError(
        "Event previous price must match the expected observation",
      );
    }
  }
}

export function listingPriceObservationsEqual(
  first: ListingPriceObservation | null,
  second: ListingPriceObservation | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }

  return (
    first.addressKey === second.addressKey &&
    first.listingKey === second.listingKey &&
    first.sourceListingId === second.sourceListingId &&
    first.latestPrice === second.latestPrice &&
    first.latestListedDate === second.latestListedDate &&
    first.latestLastSeenDate === second.latestLastSeenDate &&
    first.comparisonReady === second.comparisonReady &&
    first.observedAt === second.observedAt
  );
}

function parseExpectedPreviousObservation(
  observation: ListingPriceObservation | null,
): ListingPriceObservation | null {
  if (observation === null) {
    return null;
  }

  const result = listingPriceObservationSchema.safeParse(observation);
  if (!result.success) {
    throw new InvalidListingAlertStateError(
      `Invalid expected previous observation: ${result.error.message}`,
    );
  }
  return result.data;
}

function assertListingMatchesObservation(
  listing: RentCastNormalizedListing,
  observation: ListingPriceObservation,
): void {
  if (listing.source !== "rentcast") {
    throw new InvalidListingAlertStateError(
      "Automated listing observations must come from RentCast",
    );
  }

  let listingAddressKey: ListingAddressKey;
  try {
    listingAddressKey = createListingAddressKey(listing);
  } catch (error) {
    throw new InvalidListingAlertStateError(
      `Observed listing has an invalid structured address: ${getErrorMessage(error)}`,
    );
  }

  if (listingAddressKey !== observation.addressKey) {
    throw new InvalidListingAlertStateError(
      "Listing and observation address keys must match",
    );
  }
  if (listing.sourceListingId !== observation.sourceListingId) {
    throw new InvalidListingAlertStateError(
      "Listing and observation source identities must match",
    );
  }
  if (listing.price !== observation.latestPrice) {
    throw new InvalidListingAlertStateError(
      "Listing price must match the latest observation",
    );
  }
  if (listing.listedDate !== observation.latestListedDate) {
    throw new InvalidListingAlertStateError(
      "Listing and observation listed dates must match",
    );
  }
  if (listing.lastSeenDate !== observation.latestLastSeenDate) {
    throw new InvalidListingAlertStateError(
      "Listing and observation last-seen dates must match",
    );
  }
}

function boundedString(maximumLength: number) {
  return z.string().min(1).max(maximumLength).regex(/\S/);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
