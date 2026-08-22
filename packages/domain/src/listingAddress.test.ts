import { describe, expect, it } from "vitest";

import {
  createListingAddressKey,
  InvalidListingAddressError,
  isListingAddressKey,
  parseListingAddressKey,
} from "./listingAddress.js";

describe("listing address identity", () => {
  it("normalizes case and whitespace in structured address fields", () => {
    const first = createListingAddressKey({
      addressLine1: " 3420   New York Dr ",
      addressLine2: null,
      city: " Corona ",
      state: "CA",
      zipCode: " 92882 ",
    });
    const second = createListingAddressKey({
      addressLine1: "3420 new york dr",
      city: "corona",
      state: "ca",
      zipCode: "92882",
    });

    expect(first).toBe(
      "address:v1:3420%20new%20york%20dr||corona|ca|92882",
    );
    expect(second).toBe(first);
  });

  it("treats missing, null, and blank units as equivalent", () => {
    const base = {
      addressLine1: "100 Main St",
      city: "Chino",
      state: "CA",
      zipCode: "91710",
    };

    expect(createListingAddressKey(base)).toBe(
      createListingAddressKey({ ...base, addressLine2: null }),
    );
    expect(createListingAddressKey(base)).toBe(
      createListingAddressKey({ ...base, addressLine2: "   " }),
    );
  });

  it("keeps distinct units as distinct properties", () => {
    const base = {
      addressLine1: "100 Main St",
      city: "Chino",
      state: "CA",
      zipCode: "91710",
    };

    expect(
      createListingAddressKey({ ...base, addressLine2: "Unit 1" }),
    ).not.toBe(createListingAddressKey({ ...base, addressLine2: "Unit 2" }));
  });

  it("encodes delimiters so structured components cannot collide", () => {
    const key = createListingAddressKey({
      addressLine1: "12 A|B St",
      addressLine2: "Unit 4|5",
      city: "Corona",
      state: "CA",
      zipCode: "92882",
    });

    expect(key).toContain("12%20a%7Cb%20st|unit%204%7C5");
    expect(parseListingAddressKey(key)).toBe(key);
  });

  it.each([
    [{ city: "Corona", state: "CA", zipCode: "92882" }, "addressLine1"],
    [
      {
        addressLine1: "3420 New York Dr",
        city: "   ",
        state: "CA",
        zipCode: "92882",
      },
      "city",
    ],
    [
      {
        addressLine1: "3420 New York Dr",
        addressLine2: 2,
        city: "Corona",
        state: "CA",
        zipCode: "92882",
      },
      "addressLine2",
    ],
  ])("rejects an invalid structured address", (input, field) => {
    expect(() => createListingAddressKey(input)).toThrow(field);
  });

  it("accepts only canonical persisted keys", () => {
    const canonical = createListingAddressKey({
      addressLine1: "3420 New York Dr",
      city: "Corona",
      state: "CA",
      zipCode: "92882",
    });

    expect(isListingAddressKey(canonical)).toBe(true);
    expect(isListingAddressKey("address:v1:3420 New York Dr||corona|ca|92882"))
      .toBe(false);
    expect(isListingAddressKey("address:v2:3420%20new%20york%20dr||corona|ca|92882"))
      .toBe(false);
    expect(() => parseListingAddressKey("address:v1:too|few"))
      .toThrow(InvalidListingAddressError);
  });
});
