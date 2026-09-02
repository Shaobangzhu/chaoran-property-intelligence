import { describe, expect, it } from "vitest";

import {
  InvalidPriceDecisionAddressError,
  InvalidPriceDecisionModeError,
  normalizePriceDecisionAddress,
  normalizePriceDecisionMode,
  priceDecisionModes,
  priceDecisionState,
} from "./priceDecision.js";

describe("price decision domain", () => {
  it("normalizes a California subject address without accepting a browser state", () => {
    const address = normalizePriceDecisionAddress({
      streetAddress: "  123   Main St Apt 4  ",
      city: "  Irvine  ",
      zipCode: "92612",
    });

    expect(address).toEqual({
      streetAddress: "123 Main St Apt 4",
      city: "Irvine",
      state: "CA",
      zipCode: "92612",
    });
    expect(address.state).toBe(priceDecisionState);
    expect(Object.isFrozen(address)).toBe(true);
  });

  it("normalizes Unicode text to NFC while preserving display casing", () => {
    const address = normalizePriceDecisionAddress({
      streetAddress: "12 Calle Pen\u0303a",
      city: "Rancho Santa Margarita",
      zipCode: "92688",
    });

    expect(address.streetAddress).toBe("12 Calle Peña");
    expect(address.city).toBe("Rancho Santa Margarita");
  });

  it.each([
    null,
    [],
    {},
    {
      streetAddress: "123 Main St",
      city: "Irvine",
      state: "CA",
      zipCode: "92612",
    },
    {
      streetAddress: "123 Main St",
      city: "Irvine",
      zipCode: "92612",
      country: "US",
    },
  ])("rejects a non-exact address contract: %o", (input) => {
    expect(() => normalizePriceDecisionAddress(input)).toThrow(
      InvalidPriceDecisionAddressError,
    );
  });

  it.each([
    ["streetAddress", "Main Street", "Irvine", "92612"],
    ["streetAddress", "12345", "Irvine", "92612"],
    ["streetAddress", "123 Main St, Irvine", "Irvine", "92612"],
    ["streetAddress", "123 Main\nSt", "Irvine", "92612"],
    ["city", "123 Main St", "Irvine 2", "92612"],
    ["city", "123 Main St", "Irvine, CA", "92612"],
    ["zipCode", "123 Main St", "Irvine", "9261"],
    ["zipCode", "123 Main St", "Irvine", "92612-1234"],
  ] as const)(
    "rejects an invalid %s",
    (field, streetAddress, city, zipCode) => {
      try {
        normalizePriceDecisionAddress({ streetAddress, city, zipCode });
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPriceDecisionAddressError);
        expect((error as InvalidPriceDecisionAddressError).field).toBe(field);
        return;
      }

      throw new Error("Expected address to be rejected");
    },
  );

  it("accepts only the two explicit decision modes", () => {
    expect(priceDecisionModes).toEqual(["offer", "listing"]);
    expect(normalizePriceDecisionMode("offer")).toBe("offer");
    expect(normalizePriceDecisionMode("listing")).toBe("listing");
    expect(Object.isFrozen(priceDecisionModes)).toBe(true);
  });

  it.each(["Offer", "set-offer-price", "sale", "", null, 1])(
    "rejects invalid decision mode %o",
    (mode) => {
      expect(() => normalizePriceDecisionMode(mode)).toThrow(
        InvalidPriceDecisionModeError,
      );
    },
  );
});
