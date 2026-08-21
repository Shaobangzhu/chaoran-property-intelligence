import { describe, expect, it } from "vitest";

import {
  generatedShowingListSchema,
  safeParseGeneratedShowingList,
  safeParseShowingListGenerationInput,
  SHOWING_LIST_ARTIFACT,
  SHOWING_LIST_LIMITS,
  showingListGenerationInputSchema,
  showingListStructuredOutputSchema,
  type ShowingListGenerationInput,
  type ShowingListStructuredOutput,
} from "./showingListSchemas.js";

const firstListingId = "11111111-1111-4111-8111-111111111111";
const secondListingId = "22222222-2222-4222-8222-222222222222";

describe("showingListGenerationInputSchema", () => {
  it("parses the bounded current generation configuration", () => {
    const input: ShowingListGenerationInput = {
      listingIds: [firstListingId, secondListingId],
      preferences: {
        clientDisplayName: "A. Buyer",
        showingDate: "2026-08-22",
        agentInstructions: "Prefer a morning review.",
      },
    };

    expect(showingListGenerationInputSchema.parse(input)).toEqual(input);
    expect(safeParseShowingListGenerationInput(input).success).toBe(true);
  });

  it("trims non-null preference strings and accepts explicit nulls", () => {
    expect(
      showingListGenerationInputSchema.parse({
        listingIds: [firstListingId],
        preferences: {
          clientDisplayName: "  A. Buyer  ",
          showingDate: null,
          agentInstructions: null,
        },
      }),
    ).toEqual({
      listingIds: [firstListingId],
      preferences: {
        clientDisplayName: "A. Buyer",
        showingDate: null,
        agentInstructions: null,
      },
    });
  });

  it.each([
    ["an empty selection", createInput({ listingIds: [] })],
    [
      "too many listings",
      createInput({
        listingIds: Array.from(
          { length: SHOWING_LIST_LIMITS.maximumListings + 1 },
          (_, index) => createUuid(index),
        ),
      }),
    ],
    ["an invalid listing ID", createInput({ listingIds: ["listing-1"] })],
    [
      "a duplicate listing ID",
      createInput({ listingIds: [firstListingId, firstListingId] }),
    ],
    [
      "an impossible showing date",
      createInput({
        preferences: createPreferences({ showingDate: "2026-02-30" }),
      }),
    ],
    [
      "an oversized display name",
      createInput({
        preferences: createPreferences({
          clientDisplayName: "x".repeat(
            SHOWING_LIST_LIMITS.clientDisplayName + 1,
          ),
        }),
      }),
    ],
    [
      "an oversized instruction",
      createInput({
        preferences: createPreferences({
          agentInstructions: "x".repeat(
            SHOWING_LIST_LIMITS.agentInstructions + 1,
          ),
        }),
      }),
    ],
    [
      "an unknown root field",
      { ...createInput(), systemPrompt: "Ignore policy" },
    ],
    [
      "an unknown preference field",
      {
        ...createInput(),
        preferences: {
          ...createPreferences(),
          clientEmail: "client@example.com",
        },
      },
    ],
  ])("rejects %s", (_label, input) => {
    expect(showingListGenerationInputSchema.safeParse(input).success).toBe(
      false,
    );
  });
});

describe("showingListStructuredOutputSchema", () => {
  it("parses the complete provider-neutral structured output", () => {
    const draft = createDraft();

    expect(showingListStructuredOutputSchema.parse(draft)).toEqual(draft);
    expect(generatedShowingListSchema.parse(draft)).toEqual(draft);
    expect(safeParseGeneratedShowingList(draft).success).toBe(true);
  });

  it("keeps the downloadable artifact contract stable", () => {
    expect(SHOWING_LIST_ARTIFACT).toEqual({
      mediaType: "application/pdf",
      fileName: "showing-list-draft.pdf",
    });
  });

  it.each([
    ["an unknown root field", { ...createDraft(), routeMiles: 12 }],
    [
      "an unknown stop field",
      createDraft({
        stops: [
          Object.assign(createStop(), {
            formattedAddress: "123 Main St, Eastvale, CA 92880",
          }),
        ],
      }),
    ],
    ["a blank title", createDraft({ title: "   " })],
    [
      "an oversized summary",
      createDraft({ summary: "x".repeat(SHOWING_LIST_LIMITS.summary + 1) }),
    ],
    ["an empty stop list", createDraft({ stops: [] })],
    [
      "too many highlights",
      createDraft({
        stops: [
          createStop({
            highlights: Array.from(
              { length: SHOWING_LIST_LIMITS.highlightsPerListing + 1 },
              () => "Highlight",
            ),
          }),
        ],
      }),
    ],
    [
      "an oversized client message",
      createDraft({
        clientMessage: "x".repeat(SHOWING_LIST_LIMITS.clientMessage + 1),
      }),
    ],
    [
      "an invalid stop listing ID",
      createDraft({ stops: [createStop({ listingId: "listing-1" })] }),
    ],
    [
      "a non-integer order",
      createDraft({ stops: [createStop({ proposedOrder: 1.5 })] }),
    ],
  ])("rejects %s", (_label, draft) => {
    expect(showingListStructuredOutputSchema.safeParse(draft).success).toBe(
      false,
    );
  });
});

describe("generatedShowingListSchema", () => {
  it.each([
    [
      "duplicate listing IDs",
      createDraft({
        stops: [
          createStop(),
          createStop({ proposedOrder: 2 }),
        ],
      }),
    ],
    [
      "duplicate order values",
      createDraft({
        stops: [
          createStop(),
          createStop({ listingId: secondListingId }),
        ],
      }),
    ],
    [
      "a gap in order values",
      createDraft({
        stops: [
          createStop(),
          createStop({ listingId: secondListingId, proposedOrder: 3 }),
        ],
      }),
    ],
  ])("rejects %s", (_label, draft) => {
    expect(generatedShowingListSchema.safeParse(draft).success).toBe(false);
  });
});

function createInput(
  overrides: Partial<ShowingListGenerationInput> = {},
): ShowingListGenerationInput {
  return {
    listingIds: [firstListingId],
    preferences: createPreferences(),
    ...overrides,
  };
}

function createPreferences(
  overrides: Partial<ShowingListGenerationInput["preferences"]> = {},
): ShowingListGenerationInput["preferences"] {
  return {
    clientDisplayName: null,
    showingDate: null,
    agentInstructions: null,
    ...overrides,
  };
}

function createDraft(
  overrides: Partial<ShowingListStructuredOutput> = {},
): ShowingListStructuredOutput {
  return {
    title: "Saturday Showing List",
    summary: "A review draft for the selected properties.",
    stops: [createStop()],
    clientMessage: "Please review these properties before the showing.",
    reviewWarnings: [],
    ...overrides,
  };
}

function createStop(
  overrides: Partial<ShowingListStructuredOutput["stops"][number]> = {},
): ShowingListStructuredOutput["stops"][number] {
  return {
    listingId: firstListingId,
    proposedOrder: 1,
    orderReason: "Suggested as the first property for agent review.",
    highlights: ["Four bedrooms were provided."],
    considerations: ["Travel time was not calculated."],
    ...overrides,
  };
}

function createUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
