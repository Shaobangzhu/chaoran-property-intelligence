import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  InvalidListingSearchCriteriaError,
  listingPropertyTypes,
  listingSearchCities,
  normalizeListingSearchCriteria,
} from "./listingSearchCriteria.js";

function validInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    state: "CA",
    status: "Active",
    propertyType: "Single Family",
    minimumPrice: 780000,
    maximumPrice: 850000,
    minimumBedrooms: 4,
    minimumBathrooms: 2.5,
    cities: ["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"],
    ...overrides,
  };
}

function expectInvalid(
  overrides: Record<string, unknown>,
  field: InvalidListingSearchCriteriaError["field"],
): void {
  try {
    normalizeListingSearchCriteria(validInput(overrides));
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidListingSearchCriteriaError);
    expect((error as InvalidListingSearchCriteriaError).field).toBe(field);
    return;
  }

  throw new Error("Expected listing search criteria to be rejected");
}

describe("listing search criteria", () => {
  it("keeps an existing five-market schema-v1 profile valid and unchanged", () => {
    expect(normalizeListingSearchCriteria(validInput())).toEqual(validInput());
  });

  it("keeps Irvine opt-in while preserving the pre-Irvine default profile", () => {
    expect(defaultListingSearchCriteria).toEqual({
      ...validInput(),
      cities: [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
      ],
    });
    expect(Object.isFrozen(defaultListingSearchCriteria)).toBe(true);
    expect(Object.isFrozen(defaultListingSearchCriteria.cities)).toBe(true);
  });

  it("appends Irvine to the schema-v1 canonical market allowlist", () => {
    expect(listingSearchCities).toEqual([
      "Chino",
      "Chino Hills",
      "Eastvale",
      "Corona",
      "Jurupa Valley",
      "Stevenson Ranch",
      "Irvine",
    ]);
  });

  it.each(listingPropertyTypes)("accepts property type %s", (propertyType) => {
    expect(
      normalizeListingSearchCriteria(validInput({ propertyType })).propertyType,
    ).toBe(propertyType);
  });

  it.each(listingSearchCities)("accepts city %s by itself", (city) => {
    expect(normalizeListingSearchCriteria(validInput({ cities: [city] })).cities).toEqual([
      city,
    ]);
  });

  it("accepts Stevenson Ranch as a product-market label", () => {
    expect(
      normalizeListingSearchCriteria(
        validInput({ cities: ["Stevenson Ranch"] }),
      ).cities,
    ).toEqual(["Stevenson Ranch"]);
  });

  it("accepts Irvine as an opt-in product market", () => {
    expect(
      normalizeListingSearchCriteria(validInput({ cities: ["Irvine"] })).cities,
    ).toEqual(["Irvine"]);
  });

  it("canonicalizes selected cities into the supported city order", () => {
    const criteria = normalizeListingSearchCriteria(
      validInput({
        cities: [
          "Irvine",
          "Stevenson Ranch",
          "Jurupa Valley",
          "Chino",
          "Corona",
        ],
      }),
    );

    expect(criteria.cities).toEqual([
      "Chino",
      "Corona",
      "Jurupa Valley",
      "Stevenson Ranch",
      "Irvine",
    ]);
  });

  it("accepts the inclusive numeric boundaries", () => {
    expect(
      normalizeListingSearchCriteria(
        validInput({
          minimumPrice: 0,
          maximumPrice: 2_147_483_647,
          minimumBedrooms: 0,
          minimumBathrooms: 0,
        }),
      ),
    ).toMatchObject({
      minimumPrice: 0,
      maximumPrice: 2_147_483_647,
      minimumBedrooms: 0,
      minimumBathrooms: 0,
    });

    expect(
      normalizeListingSearchCriteria(
        validInput({ minimumBedrooms: 10, minimumBathrooms: 10 }),
      ),
    ).toMatchObject({ minimumBedrooms: 10, minimumBathrooms: 10 });
  });

  it.each([
    ["schemaVersion", { schemaVersion: 2 }],
    ["state", { state: "AZ" }],
    ["status", { status: "Pending" }],
    ["propertyType", { propertyType: "single family" }],
    ["propertyType", { propertyType: "Duplex" }],
  ] as const)("rejects an invalid %s", (field, overrides) => {
    expectInvalid(overrides, field);
  });

  it("rejects unknown top-level fields", () => {
    expectInvalid({ radius: 50 }, "criteria");
  });

  it.each(
    [
      [],
      ["Chino", "Chino"],
      ["Brea"],
      ["chino"],
      [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Brea",
      ],
    ].map((cities) => ({ cities })),
  )("rejects an invalid city selection: $cities", ({ cities }) => {
    expectInvalid({ cities }, "cities");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects invalid minimum prices: %s",
    (minimumPrice) => {
      expectInvalid({ minimumPrice }, "minimumPrice");
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects invalid maximum prices: %s",
    (maximumPrice) => {
      expectInvalid({ maximumPrice }, "maximumPrice");
    },
  );

  it("rejects a minimum price above the maximum price", () => {
    expectInvalid(
      { minimumPrice: 850001, maximumPrice: 850000 },
      "minimumPrice",
    );
  });

  it.each([-1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minimum bedrooms: %s",
    (minimumBedrooms) => {
      expectInvalid({ minimumBedrooms }, "minimumBedrooms");
    },
  );

  it.each([-0.5, 0.25, 10.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minimum bathrooms: %s",
    (minimumBathrooms) => {
      expectInvalid({ minimumBathrooms }, "minimumBathrooms");
    },
  );
});
