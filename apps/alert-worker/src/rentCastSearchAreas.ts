import {
  listingSearchCities,
  stevensonRanchListingSearchMarket,
  type ListingSearchCity,
} from "@chaoran-property-intelligence/domain";
import {
  defaultRentCastSaleListingsSearchArea,
  type RentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

export const stevensonRanchRentCastSaleListingsSearchArea = Object.freeze({
  kind: "zip",
  zipCode: "91381",
} satisfies RentCastSaleListingsSearchArea);

export class InvalidRentCastSearchMarketsError extends Error {
  constructor() {
    super("RentCast search markets were invalid");
    this.name = "InvalidRentCastSearchMarketsError";
  }
}

export function selectRentCastSaleListingsSearchAreas(
  markets: readonly ListingSearchCity[],
): readonly RentCastSaleListingsSearchArea[] {
  if (
    markets.length === 0 ||
    markets.some(
      (market) => !listingSearchCities.includes(market as ListingSearchCity),
    )
  ) {
    throw new InvalidRentCastSearchMarketsError();
  }

  const areas: RentCastSaleListingsSearchArea[] = [];
  if (markets.some((market) => market !== stevensonRanchListingSearchMarket)) {
    areas.push(defaultRentCastSaleListingsSearchArea);
  }
  if (markets.includes(stevensonRanchListingSearchMarket)) {
    areas.push(stevensonRanchRentCastSaleListingsSearchArea);
  }

  return Object.freeze(areas);
}
