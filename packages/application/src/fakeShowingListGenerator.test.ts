import { describe, expect, it } from "vitest";

import { FakeShowingListGenerator } from "./fakeShowingListGenerator.js";
import type {
  ShowingListContext,
  ShowingListGenerationResult,
} from "./showingListGenerator.js";

const listingId = "11111111-1111-4111-8111-111111111111";

describe("FakeShowingListGenerator", () => {
  it("returns its deterministic result and records every context", async () => {
    const context = createContext();
    const result = createResult();
    const generator = new FakeShowingListGenerator({
      type: "success",
      result,
    });

    await expect(generator.generate(context)).resolves.toBe(result);
    await expect(generator.generate(context)).resolves.toBe(result);
    expect(generator.calls).toEqual([context, context]);
  });

  it("throws its deterministic error after recording the context", async () => {
    const context = createContext();
    const error = new Error("provider unavailable");
    const generator = new FakeShowingListGenerator({
      type: "failure",
      error,
    });

    await expect(generator.generate(context)).rejects.toBe(error);
    expect(generator.calls).toEqual([context]);
  });
});

function createContext(): ShowingListContext {
  return {
    listings: [
      {
        id: listingId,
        formattedAddress: "123 Main St, Eastvale, CA 92880",
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
      },
    ],
    preferences: {
      clientDisplayName: "A. Buyer",
      showingDate: "2026-08-22",
      agentInstructions: "Prefer a morning review.",
    },
  };
}

function createResult(): ShowingListGenerationResult {
  return {
    draft: {
      title: "Saturday Showing List",
      summary: "A review draft for the selected properties.",
      stops: [
        {
          listingId,
          proposedOrder: 1,
          orderReason: "Suggested as the first property for agent review.",
          highlights: ["Four bedrooms were provided."],
          considerations: ["Travel time was not calculated."],
        },
      ],
      clientMessage: "Please review these properties before the showing.",
      reviewWarnings: [],
    },
    metadata: {
      model: "fake-model",
      responseId: "fake-response-id",
      inputTokens: 100,
      outputTokens: 80,
      totalTokens: 180,
      durationMs: 25,
    },
  };
}
