import type { ListingSourcePort } from "@chaoran-property-intelligence/application";
import type { RentCastNormalizedListing } from "@chaoran-property-intelligence/domain";
import type {
  RentCastListingsPort,
  RentCastSaleListing,
} from "@chaoran-property-intelligence/rentcast";

export interface RentCastListingSourceOptions {
  client: RentCastListingsPort;
  now: () => Date;
}

export class RentCastListingSource implements ListingSourcePort {
  private readonly client: RentCastListingsPort;
  private readonly now: () => Date;

  constructor(options: RentCastListingSourceOptions) {
    this.client = options.client;
    this.now = options.now;
  }

  async getActiveSaleListings(): Promise<RentCastNormalizedListing[]> {
    const listings = await this.client.searchSaleListings();
    const firstDiscoveredAt = this.now().toISOString();

    return listings.map((listing) =>
      normalizeRentCastListing(listing, firstDiscoveredAt),
    );
  }
}

function normalizeRentCastListing(
  listing: RentCastSaleListing,
  firstDiscoveredAt: string,
): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: listing.id,
    mlsName: listing.mlsName,
    mlsNumber: listing.mlsNumber,
    formattedAddress: listing.formattedAddress,
    addressLine1: listing.addressLine1,
    addressLine2: listing.addressLine2,
    city: listing.city,
    state: listing.state,
    zipCode: listing.zipCode,
    latitude: listing.latitude,
    longitude: listing.longitude,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    price: listing.price,
    status: listing.status,
    listedDate: listing.listedDate,
    lastSeenDate: listing.lastSeenDate,
    firstDiscoveredAt,
  };
}
