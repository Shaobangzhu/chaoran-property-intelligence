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
  event: ListingAlertEvent | null;
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
}

export function assertValidListingAlertTransition(
  transition: ListingAlertTransition,
): void {
  assertValidListingAlertBaselineEntry(transition);

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
