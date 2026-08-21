import { describe, expect, it } from "vitest";

import {
  InvalidManualListingRequestError,
  parseManualListingDraftDto,
  parseManualListingPatchDto,
} from "./manualListingDto.js";

describe("parseManualListingDraftDto", () => {
  it("parses the complete editable manual-listing contract", () => {
    const input = {
      addressLine1: "123 Main St",
      addressLine2: "Unit 4",
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
      mlsName: "CRMLS",
      mlsNumber: "IG26000001",
      notes: "Client referral",
    };

    expect(parseManualListingDraftDto(input)).toEqual(input);
  });

  it("keeps optional fields absent and permits explicit null", () => {
    expect(
      parseManualListingDraftDto({
        addressLine1: "123 Main St",
        city: "Eastvale",
        state: "CA",
        zipCode: "92880",
        latitude: 33.9525,
        longitude: -117.5848,
        status: "Active",
        addressLine2: null,
        price: null,
      }),
    ).toEqual({
      addressLine1: "123 Main St",
      city: "Eastvale",
      state: "CA",
      zipCode: "92880",
      latitude: 33.9525,
      longitude: -117.5848,
      status: "Active",
      addressLine2: null,
      price: null,
    });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a missing required field", createBody({ status: undefined })],
    ["a protected source field", createBody({ source: "manual" })],
    ["a protected owner field", createBody({ createdByUserId: "attacker" })],
    ["a wrong optional string", createBody({ notes: 123 })],
    ["a wrong optional number", createBody({ bedrooms: "4" })],
  ])("rejects %s", (_label, value) => {
    expect(() => parseManualListingDraftDto(value)).toThrow(
      InvalidManualListingRequestError,
    );
  });
});

describe("parseManualListingPatchDto", () => {
  it("parses a nonempty partial update and preserves explicit null", () => {
    expect(
      parseManualListingPatchDto({ city: "Corona", notes: null, price: null }),
    ).toEqual({ city: "Corona", notes: null, price: null });
  });

  it.each([
    ["an empty patch", {}],
    ["a protected field", { source: "manual" }],
    ["a null required field", { city: null }],
    ["a wrong numeric field", { latitude: "33.9" }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseManualListingPatchDto(value)).toThrow(
      InvalidManualListingRequestError,
    );
  });
});

function createBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    addressLine1: "123 Main St",
    city: "Eastvale",
    state: "CA",
    zipCode: "92880",
    latitude: 33.9525,
    longitude: -117.5848,
    status: "Active",
    ...overrides,
  };
  if (overrides.status === undefined && "status" in overrides) {
    delete body.status;
  }
  return body;
}
