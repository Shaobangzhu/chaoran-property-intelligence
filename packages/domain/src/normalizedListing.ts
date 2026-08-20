export interface NormalizedListing {
  source: "rentcast";
  sourceListingId: string;
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
