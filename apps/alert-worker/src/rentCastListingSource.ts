import type { ListingSourcePort } from "@chaoran-property-intelligence/application";
import type { RentCastNormalizedListing } from "@chaoran-property-intelligence/domain";
import type {
  RentCastListingsPort,
  RentCastSaleListing,
  RentCastSaleListingsSearchCriteria,
} from "@chaoran-property-intelligence/rentcast";

export interface RentCastListingSourceOptions {
  client: RentCastListingsPort;
  searchCriteria: RentCastSaleListingsSearchCriteria;
  now: () => Date;
}

export class RentCastListingCoverageExceededError extends Error {
  constructor() {
    super("RentCast listing search exceeded the complete response page limit");
    this.name = "RentCastListingCoverageExceededError";
  }
}

export class IncompleteRentCastListingPageError extends Error {
  constructor() {
    super("RentCast listing search returned an incomplete response page");
    this.name = "IncompleteRentCastListingPageError";
  }
}

export class RentCastListingSource implements ListingSourcePort {
  private readonly client: RentCastListingsPort;
  private readonly searchCriteria: RentCastSaleListingsSearchCriteria;
  private readonly now: () => Date;

  constructor(options: RentCastListingSourceOptions) {
    this.client = options.client;
    this.searchCriteria = options.searchCriteria;
    this.now = options.now;
  }

  async getActiveSaleListings(): Promise<RentCastNormalizedListing[]> {
    const page = await this.client.searchSaleListings(this.searchCriteria);
    if (page.totalCount > page.resultLimit) {
      throw new RentCastListingCoverageExceededError();
    }
    if (page.listings.length !== page.totalCount) {
      throw new IncompleteRentCastListingPageError();
    }

    const firstDiscoveredAt = this.now().toISOString();

    return page.listings.map((listing) =>
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
