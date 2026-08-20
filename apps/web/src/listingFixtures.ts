import type { ListingSummary } from "./listingsApi.js";

export const eastvaleListing: ListingSummary = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  source: "rentcast",
  sourceListingId: "rentcast-listing-id",
  mlsName: "CRMLS",
  mlsNumber: "IG26000001",
  formattedAddress: "123 Main St, Eastvale, CA 92880",
  addressLine1: "123 Main St",
  addressLine2: null,
  city: "Eastvale",
  state: "CA",
  zipCode: "92880",
  latitude: 33.9525,
  longitude: -117.5848,
  propertyType: "Single Family",
  bedrooms: 4,
  bathrooms: 2.5,
  price: 825000,
  status: "Active",
  listedDate: "2026-08-19",
  lastSeenDate: "2026-08-19",
  firstDiscoveredAt: "2026-08-19T17:00:00.000Z",
};

export const coronaListing: ListingSummary = {
  ...eastvaleListing,
  id: "0198c7d2-7668-7775-b0fc-b789690a60c2",
  sourceListingId: "rentcast-listing-id-2",
  mlsNumber: "IG26000002",
  formattedAddress: "456 River Rd, Corona, CA 92880",
  addressLine1: "456 River Rd",
  city: "Corona",
  latitude: 33.8753,
  longitude: -117.5664,
  price: 749000,
};
