import { isTargetCity } from "./cityFilter.js";
import {
  defaultListingSearchCriteria,
  type ListingSearchCriteriaV1,
} from "./listingSearchCriteria.js";

export interface ListingCandidate {
  city: string | null;
  state: string | null;
  status: string | null;
  propertyType: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}

export function matchesNewListingCriteria(
  listing: ListingCandidate,
  criteria: ListingSearchCriteriaV1 = defaultListingSearchCriteria,
): boolean {
  return (
    matchesListingAcquisitionCriteria(listing, criteria) &&
    listing.price !== null &&
    listing.price >= criteria.minimumPrice
  );
}

export function matchesListingAcquisitionCriteria(
  listing: ListingCandidate,
  criteria: ListingSearchCriteriaV1 = defaultListingSearchCriteria,
): boolean {
  if (
    listing.city === null ||
    !isTargetCity(listing.city, criteria.cities)
  ) {
    return false;
  }

  if (listing.state !== criteria.state) {
    return false;
  }

  if (listing.status !== criteria.status) {
    return false;
  }

  if (listing.propertyType !== criteria.propertyType) {
    return false;
  }

  if (listing.price === null) {
    return false;
  }

  if (listing.price > criteria.maximumPrice) {
    return false;
  }

  if (
    criteria.minimumBedrooms > 0 &&
    (listing.bedrooms === null ||
      listing.bedrooms < criteria.minimumBedrooms)
  ) {
    return false;
  }

  if (
    criteria.minimumBathrooms > 0 &&
    (listing.bathrooms === null ||
      listing.bathrooms < criteria.minimumBathrooms)
  ) {
    return false;
  }

  return true;
}

export function matchesMvpSearchCriteria(
  listing: ListingCandidate,
  criteria: ListingSearchCriteriaV1 = defaultListingSearchCriteria,
): boolean {
  return matchesNewListingCriteria(listing, criteria);
}

export function matchesPriceAlertAcquisitionCriteria(
  listing: ListingCandidate,
  criteria: ListingSearchCriteriaV1 = defaultListingSearchCriteria,
): boolean {
  return matchesListingAcquisitionCriteria(listing, criteria);
}
