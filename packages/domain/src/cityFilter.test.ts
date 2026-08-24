import { describe, expect, it } from "vitest";

import {
  isTargetCity,
  matchesListingSearchMarket,
} from "./cityFilter.js";

describe("target city filtering", () => {
  it("accepts the five MVP target cities", () => {
    expect(isTargetCity("Chino")).toBe(true);
    expect(isTargetCity("Chino Hills")).toBe(true);
    expect(isTargetCity("Eastvale")).toBe(true);
    expect(isTargetCity("Corona")).toBe(true);
    expect(isTargetCity("Jurupa Valley")).toBe(true);
  });

  it("rejects the search center city because radius alone is not enough", () => {
    expect(isTargetCity("Brea")).toBe(false);
  });

  it("rejects non-target cities even if they are in nearby counties", () => {
    expect(isTargetCity("Riverside")).toBe(false);
  });

  it("uses the selected criteria cities when they are provided", () => {
    expect(isTargetCity("Corona", ["Corona", "Chino"])).toBe(true);
    expect(isTargetCity("Eastvale", ["Corona", "Chino"])).toBe(false);
  });
});

describe("product-market filtering", () => {
  it("matches the original five markets by exact provider city", () => {
    expect(
      matchesListingSearchMarket(
        { city: "Corona", zipCode: "92882" },
        ["Corona"],
      ),
    ).toBe(true);
    expect(
      matchesListingSearchMarket(
        { city: "Eastvale", zipCode: "92880" },
        ["Corona"],
      ),
    ).toBe(false);
  });

  it("matches the Stevenson Ranch product market by ZIP 91381", () => {
    expect(
      matchesListingSearchMarket(
        { city: "Valencia", zipCode: "91381" },
        ["Stevenson Ranch"],
      ),
    ).toBe(true);
  });

  it("does not treat a provider city label as the Stevenson Ranch market", () => {
    expect(
      matchesListingSearchMarket(
        { city: "Valencia", zipCode: "91355" },
        ["Stevenson Ranch"],
      ),
    ).toBe(false);
    expect(
      matchesListingSearchMarket(
        { city: "Stevenson Ranch", zipCode: "91355" },
        ["Stevenson Ranch"],
      ),
    ).toBe(false);
  });

  it("rejects a missing provider city even when the ZIP matches", () => {
    expect(
      matchesListingSearchMarket(
        { city: null, zipCode: "91381" },
        ["Stevenson Ranch"],
      ),
    ).toBe(false);
  });
});
