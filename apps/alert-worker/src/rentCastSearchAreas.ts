import {
  isListingSearchCity,
  listingSearchCities,
  type ListingSearchCity,
} from "@chaoran-property-intelligence/domain";
import {
  type RentCastSaleListingsSearchArea,
} from "@chaoran-property-intelligence/rentcast";

export const stevensonRanchRentCastSaleListingsSearchArea = Object.freeze({
  kind: "zip",
  zipCode: "91381",
} satisfies RentCastSaleListingsSearchArea);

const rentCastSaleListingsSearchAreasByMarket = Object.freeze({
  Chino: Object.freeze({ kind: "city", city: "Chino" }),
  "Chino Hills": Object.freeze({ kind: "city", city: "Chino Hills" }),
  Eastvale: Object.freeze({ kind: "city", city: "Eastvale" }),
  Corona: Object.freeze({ kind: "city", city: "Corona" }),
  "Jurupa Valley": Object.freeze({ kind: "city", city: "Jurupa Valley" }),
  "Stevenson Ranch": stevensonRanchRentCastSaleListingsSearchArea,
} satisfies Readonly<
  Record<ListingSearchCity, RentCastSaleListingsSearchArea>
>);

export class InvalidRentCastSearchMarketsError extends Error {
  constructor() {
    super("RentCast search markets were invalid");
    this.name = "InvalidRentCastSearchMarketsError";
  }
}

export function selectRentCastSaleListingsSearchAreas(
  markets: readonly ListingSearchCity[],
): readonly RentCastSaleListingsSearchArea[] {
  if (!Array.isArray(markets) || markets.length === 0) {
    throw new InvalidRentCastSearchMarketsError();
  }

  const selectedMarkets = new Set<ListingSearchCity>();
  for (const market of markets as readonly unknown[]) {
    if (!isListingSearchCity(market) || selectedMarkets.has(market)) {
      throw new InvalidRentCastSearchMarketsError();
    }
    selectedMarkets.add(market);
  }

  return Object.freeze(
    listingSearchCities
      .filter((market) => selectedMarkets.has(market))
      .map((market) => rentCastSaleListingsSearchAreasByMarket[market]),
  );
}
