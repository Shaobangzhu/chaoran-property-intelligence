import type { ListingSummary } from "./listingsApi.js";

export interface ListingPointFeatureCollection {
  type: "FeatureCollection";
  features: ListingPointFeature[];
}

interface ListingPointFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [longitude: number, latitude: number];
  };
  properties: {
    id: string;
    selected: boolean;
  };
}

export function listingsToFeatureCollection(
  listings: ListingSummary[],
  selectedListingId: string | null,
): ListingPointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: listings.map((listing) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [listing.longitude, listing.latitude],
      },
      properties: {
        id: listing.id,
        selected: listing.id === selectedListingId,
      },
    })),
  };
}
