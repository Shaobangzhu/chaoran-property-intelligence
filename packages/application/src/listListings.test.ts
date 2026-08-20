import { describe, expect, it } from "vitest";

import type { NormalizedListing } from "@chaoran-property-intelligence/domain";

import {
  ListListings,
  type ListingQueryPort,
  type ListingRecord,
} from "./listListings.js";

describe("ListListings", () => {
  it("returns the persisted listing records from the query port", async () => {
    const records = [createListingRecord()];
    const query = new FakeListingQuery(records);
    const listListings = new ListListings({ query });

    await expect(listListings.execute()).resolves.toEqual(records);
    expect(query.callCount).toBe(1);
  });
});

class FakeListingQuery implements ListingQueryPort {
  callCount = 0;

  constructor(private readonly records: ListingRecord[]) {}

  async listListings(): Promise<ListingRecord[]> {
    this.callCount += 1;
    return this.records;
  }
}

function createListingRecord(): ListingRecord {
  return {
    id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    listing: createListing(),
  };
}

function createListing(): NormalizedListing {
  return {
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
}
