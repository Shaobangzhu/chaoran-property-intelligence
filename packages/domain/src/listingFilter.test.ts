import { describe, expect, it } from "vitest";

import {
  matchesMvpSearchCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type ListingCandidate,
} from "./listingFilter.js";

describe("MVP listing search criteria", () => {
  const matchingListing: ListingCandidate = {
    city: "Eastvale",
    state: "CA",
    status: "Active",
    propertyType: "Single Family",
    price: 825000,
    bedrooms: 4,
    bathrooms: 3,
  };

  function withListingOverride(
    override: Partial<ListingCandidate>,
  ): ListingCandidate {
    return {
      ...matchingListing,
      ...override,
    };
  }

  it("accepts a listing that matches all MVP search criteria", () => {
    expect(matchesMvpSearchCriteria(matchingListing)).toBe(true);
  });

  it("rejects listings outside the target cities", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ city: "Brea" })),
    ).toBe(false);
  });

  it("rejects listings outside California", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ state: "AZ" })),
    ).toBe(false);
  });

  it("rejects listings that are not active", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ status: "Pending" })),
    ).toBe(false);
  });

  it("rejects listings that are not single family homes", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ propertyType: "Condo" })),
    ).toBe(false);
  });

  it("rejects listings below the minimum price", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ price: 779999 })),
    ).toBe(false);
  });

  it("accepts listings at the price boundaries", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ price: 780000 })),
    ).toBe(true);
    expect(
      matchesMvpSearchCriteria(withListingOverride({ price: 850000 })),
    ).toBe(true);
  });

  it("rejects listings above the maximum price", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ price: 850001 })),
    ).toBe(false);
  });

  it("rejects listings with fewer than four bedrooms", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ bedrooms: 3 })),
    ).toBe(false);
  });

  it("rejects listings with fewer than 2.5 bathrooms", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ bathrooms: 2 })),
    ).toBe(false);
  });

  it("accepts listings with exactly 2.5 bathrooms", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ bathrooms: 2.5 })),
    ).toBe(true);
  });

  it("rejects listings with missing required fields", () => {
    expect(
      matchesMvpSearchCriteria(withListingOverride({ city: null })),
    ).toBe(false);
    expect(
      matchesMvpSearchCriteria(withListingOverride({ price: null })),
    ).toBe(false);
  });
});

describe("price-alert acquisition criteria", () => {
  const matchingListing: ListingCandidate = {
    city: "Eastvale",
    state: "CA",
    status: "Active",
    propertyType: "Single Family",
    price: 825000,
    bedrooms: 4,
    bathrooms: 3,
  };

  it("retains eligible listings below the new-listing price floor", () => {
    expect(
      matchesPriceAlertAcquisitionCriteria({
        ...matchingListing,
        price: 575875,
      }),
    ).toBe(true);
  });

  it("retains the upper price limit", () => {
    expect(
      matchesPriceAlertAcquisitionCriteria({
        ...matchingListing,
        price: 850000,
      }),
    ).toBe(true);
    expect(
      matchesPriceAlertAcquisitionCriteria({
        ...matchingListing,
        price: 850001,
      }),
    ).toBe(false);
  });

  it.each([
    { city: "Brea" },
    { state: "AZ" },
    { status: "Pending" },
    { propertyType: "Condo" },
    { bedrooms: 3 },
    { bathrooms: 2 },
    { price: null },
  ] satisfies Partial<ListingCandidate>[])(
    "retains all non-minimum eligibility constraints: %o",
    (override) => {
      expect(
        matchesPriceAlertAcquisitionCriteria({
          ...matchingListing,
          ...override,
        }),
      ).toBe(false);
    },
  );
});
