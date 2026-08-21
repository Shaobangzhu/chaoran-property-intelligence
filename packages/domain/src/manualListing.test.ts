import { describe, expect, it } from "vitest";

import {
  InvalidManualListingError,
  normalizeManualListingDraft,
  type ManualListingDraftInput,
} from "./manualListing.js";

const now = new Date("2026-08-20T19:30:00.000Z");

describe("normalizeManualListingDraft", () => {
  it("normalizes editable fields and derives server-controlled listing facts", () => {
    expect(
      normalizeManualListingDraft(
        createDraft({
          addressLine1: "  123 Main St  ",
          addressLine2: "  Unit 4  ",
          city: "  Eastvale  ",
          state: " ca ",
          zipCode: " 92880 ",
          propertyType: "  Single Family  ",
          mlsName: "   ",
          mlsNumber: null,
          notes: "  Client referral  ",
        }),
        now,
      ),
    ).toEqual({
      listing: {
        source: "manual",
        sourceListingId: null,
        mlsName: null,
        mlsNumber: null,
        formattedAddress: "123 Main St Unit 4, Eastvale, CA 92880",
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
        lastSeenDate: "2026-08-20",
        firstDiscoveredAt: "2026-08-20T19:30:00.000Z",
      },
      notes: "Client referral",
    });
  });

  it("converts omitted and blank optional facts to null", () => {
    const draft = createDraft({
      addressLine2: " ",
      bathrooms: null,
      listedDate: " ",
      mlsNumber: " ",
    });
    delete draft.propertyType;
    delete draft.bedrooms;
    delete draft.price;
    delete draft.mlsName;
    delete draft.notes;

    const normalized = normalizeManualListingDraft(
      draft,
      now,
    );

    expect(normalized.listing).toMatchObject({
      addressLine2: null,
      propertyType: null,
      bedrooms: null,
      bathrooms: null,
      price: null,
      listedDate: null,
      mlsName: null,
      mlsNumber: null,
    });
    expect(normalized.notes).toBeNull();
  });

  it.each([
    ["addressLine1", { addressLine1: " " }],
    ["city", { city: "" }],
    ["state", { state: "AZ" }],
    ["zipCode", { zipCode: "9288" }],
    ["status", { status: "Sold" }],
    ["latitude", { latitude: Number.NaN }],
    ["latitude", { latitude: 90.0001 }],
    ["longitude", { longitude: Number.POSITIVE_INFINITY }],
    ["longitude", { longitude: -180.0001 }],
    ["bedrooms", { bedrooms: -1 }],
    ["bathrooms", { bathrooms: 101 }],
    ["price", { price: 825000.5 }],
    ["price", { price: 2147483648 }],
    ["listedDate", { listedDate: "2026-02-30" }],
    ["propertyType", { propertyType: "x".repeat(101) }],
    ["notes", { notes: "x".repeat(4001) }],
  ] as const)("rejects invalid %s input", (field, override) => {
    expect(() =>
      normalizeManualListingDraft(createDraft(override), now),
    ).toThrow(
      expect.objectContaining<Partial<InvalidManualListingError>>({
        name: "InvalidManualListingError",
        field,
        message: "Manual listing input was invalid",
      }),
    );
  });

  it("rejects an invalid server clock separately from user input", () => {
    expect(() =>
      normalizeManualListingDraft(createDraft(), new Date(Number.NaN)),
    ).toThrow("Manual listing clock was invalid");
  });
});

function createDraft(
  overrides: Partial<ManualListingDraftInput> = {},
): ManualListingDraftInput {
  return {
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
    mlsName: null,
    mlsNumber: null,
    notes: null,
    ...overrides,
  };
}
