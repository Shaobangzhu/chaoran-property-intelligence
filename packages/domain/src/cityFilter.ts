import {
  defaultListingSearchCriteria,
  type ListingSearchCity,
} from "./listingSearchCriteria.js";

export function isTargetCity(
  city: string,
  targetCities: readonly ListingSearchCity[] =
    defaultListingSearchCriteria.cities,
): boolean {
  return targetCities.includes(city as ListingSearchCity);
}
