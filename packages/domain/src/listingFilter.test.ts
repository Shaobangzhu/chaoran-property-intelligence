import { describe, expect, it } from "vitest";

import {
  matchesListingAcquisitionCriteria,
  matchesMvpSearchCriteria,
  matchesNewListingCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type ListingCandidate,
} from "./listingFilter.js";
import { normalizeListingSearchCriteria } from "./listingSearchCriteria.js";

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

describe("configurable listing search criteria", () => {
  const condoInCorona: ListingCandidate = {
    city: "Corona",
    state: "CA",
    status: "Active",
    propertyType: "Condo",
    price: 650000,
    bedrooms: 2,
    bathrooms: 1.5,
  };
  const criteria = normalizeListingSearchCriteria({
    schemaVersion: 1,
    state: "CA",
    status: "Active",
    propertyType: "Condo",
    minimumPrice: 600000,
    maximumPrice: 700000,
    minimumBedrooms: 2,
    minimumBathrooms: 1.5,
    cities: ["Corona", "Chino"],
  });

  it("matches a listing against a supplied criteria value", () => {
    expect(matchesListingAcquisitionCriteria(condoInCorona, criteria)).toBe(
      true,
    );
    expect(matchesNewListingCriteria(condoInCorona, criteria)).toBe(true);
  });

  it.each([
    { city: "Eastvale" },
    { propertyType: "Single Family" },
    { price: 700001 },
    { bedrooms: 1 },
    { bathrooms: 1 },
  ] satisfies Partial<ListingCandidate>[])(
    "applies every configurable acquisition boundary: %o",
    (override) => {
      expect(
        matchesListingAcquisitionCriteria(
          { ...condoInCorona, ...override },
          criteria,
        ),
      ).toBe(false);
    },
  );

  it("keeps minimum price out of acquisition and inside new-listing eligibility", () => {
    const belowFloor = { ...condoInCorona, price: 575000 };

    expect(matchesListingAcquisitionCriteria(belowFloor, criteria)).toBe(true);
    expect(matchesNewListingCriteria(belowFloor, criteria)).toBe(false);
  });

  it("treats zero bedroom and bathroom minimums as Any for nullable land data", () => {
    const landCriteria = normalizeListingSearchCriteria({
      ...criteria,
      propertyType: "Land",
      minimumBedrooms: 0,
      minimumBathrooms: 0,
    });

    expect(
      matchesNewListingCriteria(
        {
          ...condoInCorona,
          propertyType: "Land",
          bedrooms: null,
          bathrooms: null,
        },
        landCriteria,
      ),
    ).toBe(true);
  });

  it("keeps legacy predicate exports on the exact default criteria", () => {
    expect(matchesPriceAlertAcquisitionCriteria(condoInCorona)).toBe(false);
    expect(matchesMvpSearchCriteria(condoInCorona)).toBe(false);
  });
});
