export type ListingSource = "rentcast" | "manual";

interface NormalizedListingBase {
  mlsName: string | null;
  mlsNumber: string | null;
  formattedAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  status: string;
  lastSeenDate: string;
  firstDiscoveredAt: string;
}

export interface RentCastNormalizedListing extends NormalizedListingBase {
  source: "rentcast";
  sourceListingId: string;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  listedDate: string;
}

export interface ManualNormalizedListing extends NormalizedListingBase {
  source: "manual";
  sourceListingId: null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  listedDate: string | null;
}

export type NormalizedListing =
  | RentCastNormalizedListing
  | ManualNormalizedListing;
