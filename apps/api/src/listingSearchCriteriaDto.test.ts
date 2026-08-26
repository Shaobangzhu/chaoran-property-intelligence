import {
  maximumListingSearchBathrooms,
  maximumListingSearchBedrooms,
  maximumListingSearchPrice,
} from "@chaoran-property-intelligence/domain";
import { describe, expect, it } from "vitest";

import {
  InvalidListingSearchCriteriaRequestError,
  parseUpdateListingSearchCriteriaRequest,
  toListingSearchCriteriaResponse,
} from "./listingSearchCriteriaDto.js";

describe("listing search criteria DTO", () => {
  it("accepts exact editable fields and canonicalizes city order", () => {
    expect(
      parseUpdateListingSearchCriteriaRequest({
        expectedRevision: 7,
        criteria: {
          propertyType: "Townhouse",
          minimumPrice: 0,
          maximumPrice: maximumListingSearchPrice,
          minimumBedrooms: maximumListingSearchBedrooms,
          minimumBathrooms: maximumListingSearchBathrooms,
          cities: ["Jurupa Valley", "Chino", "Corona"],
        },
      }),
    ).toEqual({
      expectedRevision: 7,
      criteria: {
        propertyType: "Townhouse",
        minimumPrice: 0,
        maximumPrice: maximumListingSearchPrice,
        minimumBedrooms: maximumListingSearchBedrooms,
        minimumBathrooms: maximumListingSearchBathrooms,
        cities: ["Chino", "Corona", "Jurupa Valley"],
      },
    });
  });

  it("accepts Stevenson Ranch as a schema-v1 product market", () => {
    expect(
      parseUpdateListingSearchCriteriaRequest({
        expectedRevision: 7,
        criteria: { ...validCriteria(), cities: ["Stevenson Ranch"] },
      }),
    ).toMatchObject({
      expectedRevision: 7,
      criteria: { cities: ["Stevenson Ranch"] },
    });
  });

  it("accepts Irvine and keeps it last in canonical market order", () => {
    expect(
      parseUpdateListingSearchCriteriaRequest({
        expectedRevision: 7,
        criteria: {
          ...validCriteria(),
          cities: ["Irvine", "Corona", "Stevenson Ranch"],
        },
      }),
    ).toMatchObject({
      expectedRevision: 7,
      criteria: { cities: ["Corona", "Stevenson Ranch", "Irvine"] },
    });
  });

  it.each([
    null,
    [],
    {},
    { expectedRevision: 0, criteria: validCriteria() },
    { expectedRevision: 1.5, criteria: validCriteria() },
    { expectedRevision: 1, criteria: { ...validCriteria(), state: "CA" } },
    { expectedRevision: 1, criteria: { ...validCriteria(), status: "Active" } },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), schemaVersion: 1 },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), propertyType: "Duplex" },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), maximumPrice: maximumListingSearchPrice + 1 },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), minimumBedrooms: 1.5 },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), minimumBathrooms: 2.25 },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), cities: [] },
    },
    {
      expectedRevision: 1,
      criteria: { ...validCriteria(), cities: ["Chino", "Chino"] },
    },
  ])("rejects invalid or non-editable input %#", (value) => {
    expect(() => parseUpdateListingSearchCriteriaRequest(value)).toThrow(
      InvalidListingSearchCriteriaRequestError,
    );
  });

  it("projects only the public criteria result fields", () => {
    const result = {
      criteria: validCriteria(),
      revision: 3,
      updatedAt: "2026-08-22T20:00:00.000Z",
      appliedRevision: 2,
      updatedByUserId: "0198c7d2-7668-7775-b0fc-b789690a60c1",
    };

    const response = toListingSearchCriteriaResponse(result);

    expect(response).toEqual({
      searchCriteria: {
        criteria: validCriteria(),
        revision: 3,
        updatedAt: "2026-08-22T20:00:00.000Z",
      },
    });
    expect(JSON.stringify(response)).not.toContain("appliedRevision");
    expect(JSON.stringify(response)).not.toContain("updatedByUserId");
  });
});

function validCriteria() {
  return {
    propertyType: "Single Family" as const,
    minimumPrice: 780000,
    maximumPrice: 850000,
    minimumBedrooms: 4,
    minimumBathrooms: 2.5,
    cities: [
      "Chino",
      "Chino Hills",
      "Eastvale",
      "Corona",
      "Jurupa Valley",
    ] as const,
  };
}
