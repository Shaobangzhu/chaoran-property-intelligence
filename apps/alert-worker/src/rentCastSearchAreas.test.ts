import { describe, expect, it } from "vitest";

import { defaultRentCastSaleListingsSearchArea } from "@chaoran-property-intelligence/rentcast";

import {
  InvalidRentCastSearchMarketsError,
  selectRentCastSaleListingsSearchAreas,
  stevensonRanchRentCastSaleListingsSearchArea,
} from "./rentCastSearchAreas.js";

describe("RentCast search area selection", () => {
  it.each([
    "Chino",
    "Chino Hills",
    "Corona",
    "Eastvale",
    "Jurupa Valley",
  ] as const)("maps the %s market to the Brea radius", (market) => {
    expect(
      selectRentCastSaleListingsSearchAreas([market]),
    ).toEqual([defaultRentCastSaleListingsSearchArea]);
  });

  it("maps all original markets to the Brea radius only once", () => {
    expect(
      selectRentCastSaleListingsSearchAreas([
        "Chino",
        "Chino Hills",
        "Corona",
        "Eastvale",
        "Jurupa Valley",
      ]),
    ).toEqual([defaultRentCastSaleListingsSearchArea]);
  });

  it("maps Stevenson Ranch alone to ZIP 91381", () => {
    expect(selectRentCastSaleListingsSearchAreas(["Stevenson Ranch"])).toEqual([
      stevensonRanchRentCastSaleListingsSearchArea,
    ]);
  });

  it("maps mixed markets to the Brea radius and then ZIP 91381", () => {
    expect(
      selectRentCastSaleListingsSearchAreas([
        "Stevenson Ranch",
        "Corona",
        "Chino",
      ]),
    ).toEqual([
      defaultRentCastSaleListingsSearchArea,
      stevensonRanchRentCastSaleListingsSearchArea,
    ]);
  });

  it("rejects an empty or unsupported runtime market selection", () => {
    expect(() => selectRentCastSaleListingsSearchAreas([])).toThrow(
      InvalidRentCastSearchMarketsError,
    );
    expect(() =>
      selectRentCastSaleListingsSearchAreas(["Valencia" as "Corona"]),
    ).toThrow(InvalidRentCastSearchMarketsError);
  });
});
