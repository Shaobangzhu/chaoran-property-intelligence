import type { RentCastNormalizedListing } from "@chaoran-property-intelligence/domain";

export function createListingKey(
  listing: RentCastNormalizedListing,
): string {
  if (listing.mlsName !== null && listing.mlsNumber !== null) {
    return `mls:${listing.mlsName}:${listing.mlsNumber}:${listing.listedDate}`;
  }

  return `${listing.source}:${listing.sourceListingId}:${listing.listedDate}`;
}
