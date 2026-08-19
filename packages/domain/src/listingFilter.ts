import { isTargetCity } from "./cityFilter.js";

const requiredState = "CA";
const requiredStatus = "Active";
const requiredPropertyType = "Single Family";
const minimumPrice = 780000;
const maximumPrice = 850000;
const minimumBedrooms = 4;
const minimumBathrooms = 2.5;

export interface ListingCandidate {
  city: string | null;
  state: string | null;
  status: string | null;
  propertyType: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}

export function matchesMvpSearchCriteria(listing: ListingCandidate): boolean {
  if (listing.city === null || !isTargetCity(listing.city)) {
    return false;
  }

  if (listing.state !== requiredState) {
    return false;
  }

  if (listing.status !== requiredStatus) {
    return false;
  }

  if (listing.propertyType !== requiredPropertyType) {
    return false;
  }

  if (listing.price === null) {
    return false;
  }

  if (listing.price < minimumPrice || listing.price > maximumPrice) {
    return false;
  }

  if (listing.bedrooms === null || listing.bedrooms < minimumBedrooms) {
    return false;
  }

  if (listing.bathrooms === null || listing.bathrooms < minimumBathrooms) {
    return false;
  }

  return true;
}
