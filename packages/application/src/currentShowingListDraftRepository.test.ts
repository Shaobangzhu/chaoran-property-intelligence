import { describe, expect, it } from "vitest";

import {
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  safeParseCurrentShowingListDraft,
  safeParseReplaceCurrentShowingListDraftInput,
  type CurrentShowingListDraft,
  type ReplaceCurrentShowingListDraftInput,
} from "./currentShowingListDraftRepository.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const generationId = "0198c7d2-7668-7775-b0fc-b789690a60c3";

describe("current Showing List draft persistence contracts", () => {
  it("accepts one bounded replacement at the stable artifact key", () => {
    const input = createReplaceInput();

    expect(safeParseReplaceCurrentShowingListDraftInput(input)).toEqual({
      success: true,
      data: input,
    });
    expect(input.artifact.key).toBe("showing-lists/current.pdf");
  });

  it("rejects a history or dated artifact key", () => {
    const input = {
      ...createReplaceInput(),
      artifact: {
        key: "showing-lists/2026-08-20.pdf",
        etag: '"artifact-etag"',
      },
    };

    expect(safeParseReplaceCurrentShowingListDraftInput(input).success).toBe(
      false,
    );
  });

  it("rejects unknown persistence fields", () => {
    expect(
      safeParseReplaceCurrentShowingListDraftInput({
        ...createReplaceInput(),
        apiKey: "must-not-be-persisted",
      }).success,
    ).toBe(false);
  });

  it("accepts pending, failed, and delivered current states", () => {
    expect(safeParseCurrentShowingListDraft(createCurrentDraft()).success).toBe(
      true,
    );
    expect(
      safeParseCurrentShowingListDraft(
        createCurrentDraft({ deliveryStatus: "failed" }),
      ).success,
    ).toBe(true);
    expect(
      safeParseCurrentShowingListDraft(
        createCurrentDraft({
          deliveryStatus: "sent",
          deliveredAt: "2026-08-20T20:05:00.000Z",
        }),
      ).success,
    ).toBe(true);
  });

  it("requires sent state and delivery timestamp to agree", () => {
    expect(
      safeParseCurrentShowingListDraft(
        createCurrentDraft({ deliveryStatus: "sent", deliveredAt: null }),
      ).success,
    ).toBe(false);
    expect(
      safeParseCurrentShowingListDraft(
        createCurrentDraft({
          deliveryStatus: "pending",
          deliveredAt: "2026-08-20T20:05:00.000Z",
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an update timestamp before generation", () => {
    expect(
      safeParseCurrentShowingListDraft(
        createCurrentDraft({ updatedAt: "2026-08-20T19:59:59.999Z" }),
      ).success,
    ).toBe(false);
  });

  it("revalidates the nested generated draft", () => {
    const current = createCurrentDraft();

    expect(
      safeParseCurrentShowingListDraft({
        ...current,
        draft: {
          ...current.draft,
          stops: [current.draft.stops[0], current.draft.stops[0]],
        },
      }).success,
    ).toBe(false);
  });
});

function createReplaceInput(
  overrides: Partial<ReplaceCurrentShowingListDraftInput> = {},
): ReplaceCurrentShowingListDraftInput {
  return {
    generationId,
    createdByUserId: actorUserId,
    promptVersion: "v1",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: "Alex",
        showingDate: "2026-08-23",
        agentInstructions: null,
      },
    },
    draft: {
      title: "Saturday Showing List",
      summary: "An unreviewed draft for the selected properties.",
      stops: [
        {
          listingId,
          proposedOrder: 1,
          orderReason: "Suggested order for agent review.",
          highlights: ["Four bedrooms"],
          considerations: ["Confirm showing availability"],
        },
      ],
      clientMessage: "Please review these properties before the showing.",
      reviewWarnings: ["Licensed-agent review is required."],
    },
    generationMetadata: {
      model: "gpt-5.6-terra",
      responseId: "resp_123",
      inputTokens: 100,
      outputTokens: 80,
      totalTokens: 180,
      durationMs: 1_250,
    },
    artifact: {
      key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      etag: '"artifact-etag"',
    },
    generatedAt: "2026-08-20T20:00:00.000Z",
    ...overrides,
  };
}

function createCurrentDraft(
  overrides: Partial<CurrentShowingListDraft> = {},
): CurrentShowingListDraft {
  return {
    ...createReplaceInput(),
    status: "draft",
    deliveryStatus: "pending",
    deliveredAt: null,
    updatedAt: "2026-08-20T20:00:00.000Z",
    ...overrides,
  };
}
