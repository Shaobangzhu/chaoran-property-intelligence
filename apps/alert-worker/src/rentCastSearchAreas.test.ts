import { describe, expect, it } from "vitest";

import type { ListingSearchCity } from "@chaoran-property-intelligence/domain";

import {
  InvalidRentCastSearchMarketsError,
  selectRentCastSaleListingsSearchAreas,
  stevensonRanchRentCastSaleListingsSearchArea,
} from "./rentCastSearchAreas.js";

describe("RentCast search area selection", () => {
  it.each([
    "Chino",
    "Chino Hills",
    "Eastvale",
    "Corona",
    "Jurupa Valley",
  ] as const)("maps the %s market to its direct city area", (market) => {
    expect(
      selectRentCastSaleListingsSearchAreas([market]),
    ).toEqual([{ kind: "city", city: market }]);
  });

  it("maps all five incorporated markets to five canonical direct city areas", () => {
    expect(
      selectRentCastSaleListingsSearchAreas([
        "Jurupa Valley",
        "Corona",
        "Eastvale",
        "Chino Hills",
        "Chino",
      ]),
    ).toEqual([
      { kind: "city", city: "Chino" },
      { kind: "city", city: "Chino Hills" },
      { kind: "city", city: "Eastvale" },
      { kind: "city", city: "Corona" },
      { kind: "city", city: "Jurupa Valley" },
    ]);
  });

  it("maps Stevenson Ranch alone to ZIP 91381", () => {
    expect(selectRentCastSaleListingsSearchAreas(["Stevenson Ranch"])).toEqual([
      stevensonRanchRentCastSaleListingsSearchArea,
    ]);
  });

  it("maps mixed markets in canonical order and preserves ZIP 91381", () => {
    expect(
      selectRentCastSaleListingsSearchAreas([
        "Stevenson Ranch",
        "Corona",
        "Chino",
      ]),
    ).toEqual([
      { kind: "city", city: "Chino" },
      { kind: "city", city: "Corona" },
      stevensonRanchRentCastSaleListingsSearchArea,
    ]);
  });

  it("maps all six markets to exactly six canonical provider areas", () => {
    expect(
      selectRentCastSaleListingsSearchAreas([
        "Stevenson Ranch",
        "Jurupa Valley",
        "Corona",
        "Eastvale",
        "Chino Hills",
        "Chino",
      ]),
    ).toEqual([
      { kind: "city", city: "Chino" },
      { kind: "city", city: "Chino Hills" },
      { kind: "city", city: "Eastvale" },
      { kind: "city", city: "Corona" },
      { kind: "city", city: "Jurupa Valley" },
      stevensonRanchRentCastSaleListingsSearchArea,
    ]);
  });

  it("fails closed for Irvine until its reviewed worker mapping is enabled", () => {
    expect(() => selectRentCastSaleListingsSearchAreas(["Irvine"])).toThrow(
      InvalidRentCastSearchMarketsError,
    );
    expect(() =>
      selectRentCastSaleListingsSearchAreas(["Corona", "Irvine"]),
    ).toThrow(InvalidRentCastSearchMarketsError);
  });

  it("returns frozen areas without mutating the selected markets", () => {
    const markets = ["Stevenson Ranch", "Corona", "Chino"] as const;
    const areas = selectRentCastSaleListingsSearchAreas(markets);

    expect(markets).toEqual(["Stevenson Ranch", "Corona", "Chino"]);
    expect(Object.isFrozen(areas)).toBe(true);
    expect(areas.every((area) => Object.isFrozen(area))).toBe(true);
  });

  it("rejects empty, duplicate, unsupported, or malformed runtime selections", () => {
    expect(() => selectRentCastSaleListingsSearchAreas([])).toThrow(
      InvalidRentCastSearchMarketsError,
    );
    expect(() =>
      selectRentCastSaleListingsSearchAreas(["Corona", "Corona"]),
    ).toThrow(InvalidRentCastSearchMarketsError);
    expect(() =>
      selectRentCastSaleListingsSearchAreas(["Valencia" as "Corona"]),
    ).toThrow(InvalidRentCastSearchMarketsError);
    expect(() =>
      selectRentCastSaleListingsSearchAreas(
        null as unknown as readonly ListingSearchCity[],
      ),
    ).toThrow(InvalidRentCastSearchMarketsError);
  });
});
