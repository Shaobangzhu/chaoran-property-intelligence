import type { ListingRecord } from "@chaoran-property-intelligence/application";

export interface ListListingsResponse {
  listings: ListingSummaryDto[];
}

export interface ListingSummaryDto {
  id: string;
  source: "rentcast" | "manual";
  sourceListingId: string | null;
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
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  status: string;
  listedDate: string;
  lastSeenDate: string;
  firstDiscoveredAt: string;
}

export function toListingSummaryDto(
  record: ListingRecord,
): ListingSummaryDto {
  const listing = record.listing;

  return {
    id: record.id,
    source: listing.source,
    sourceListingId: listing.sourceListingId,
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
    firstDiscoveredAt: listing.firstDiscoveredAt,
  };
}
