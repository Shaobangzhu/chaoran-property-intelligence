import {
  defaultListingSearchCriteria,
  type ListingSearchCity,
} from "./listingSearchCriteria.js";

export const stevensonRanchListingSearchMarket = "Stevenson Ranch" as const;
export const stevensonRanchListingSearchZipCode = "91381" as const;

export interface ListingSearchMarketLocation {
  readonly city: string | null;
  readonly zipCode: string | null | undefined;
}

export function isTargetCity(
  city: string,
  targetCities: readonly ListingSearchCity[] =
    defaultListingSearchCriteria.cities,
): boolean {
  return targetCities.includes(city as ListingSearchCity);
}

export function matchesListingSearchMarket(
  location: ListingSearchMarketLocation,
  targetMarkets: readonly ListingSearchCity[] =
    defaultListingSearchCriteria.cities,
): boolean {
  if (location.city === null) {
    return false;
  }

  return targetMarkets.some((market) =>
    market === stevensonRanchListingSearchMarket
      ? location.zipCode === stevensonRanchListingSearchZipCode
      : location.city === market,
  );
}
