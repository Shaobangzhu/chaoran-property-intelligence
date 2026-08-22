import type { ListingAddressKey } from "@chaoran-property-intelligence/domain";

const LISTING_ALERT_EVENT_KEY_PREFIX = "listing-alert:v1";

export interface NewListingAlertEventIdentity {
  addressKey: ListingAddressKey;
  listingKey: string;
  currentPrice: number;
  latestLastSeenDate: string;
}

export interface PriceDropListingAlertEventIdentity
  extends NewListingAlertEventIdentity {
  previousPrice: number;
  previousObservedAt: string;
}

export function createNewListingAlertEventKey(
  identity: NewListingAlertEventIdentity,
): string {
  return [
    LISTING_ALERT_EVENT_KEY_PREFIX,
    "new-listing",
    encodeKeyPart(identity.addressKey),
    encodeKeyPart(identity.listingKey),
    identity.currentPrice,
    encodeKeyPart(identity.latestLastSeenDate),
  ].join(":");
}

export function createPriceDropListingAlertEventKey(
  identity: PriceDropListingAlertEventIdentity,
): string {
  return [
    LISTING_ALERT_EVENT_KEY_PREFIX,
    "price-drop",
    encodeKeyPart(identity.addressKey),
    encodeKeyPart(identity.listingKey),
    identity.previousPrice,
    identity.currentPrice,
    encodeKeyPart(identity.previousObservedAt),
    encodeKeyPart(identity.latestLastSeenDate),
  ].join(":");
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}
