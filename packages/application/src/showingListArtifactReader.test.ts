import { describe, expect, it } from "vitest";

import {
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  type CurrentShowingListDraft,
} from "./currentShowingListDraftRepository.js";
import {
  CurrentShowingListDraftNotFoundError,
  GetCurrentShowingListArtifact,
  ShowingListArtifactReaderInvalidResponseError,
  type ShowingListArtifactReaderPort,
} from "./showingListArtifactReader.js";

describe("GetCurrentShowingListArtifact", () => {
  it("reads the artifact matching the current database ETag", async () => {
    const calls: unknown[] = [];
    const reader: ShowingListArtifactReaderPort = {
      async readCurrentArtifact(expected) {
        calls.push(expected);
        return {
          bytes: new Uint8Array([37, 80, 68, 70]),
          fileName: "showing-list-draft.pdf",
          mediaType: "application/pdf",
        };
      },
    };
    const useCase = new GetCurrentShowingListArtifact({
      reader,
      repository: { async findCurrentDraft() { return createCurrent(); } },
    });

    const result = await useCase.execute();

    expect(calls).toEqual([
      { etag: '"artifact-etag"', key: SHOWING_LIST_CURRENT_ARTIFACT_KEY },
    ]);
    expect([...result.bytes]).toEqual([37, 80, 68, 70]);
  });

  it("reports a missing current draft without reading storage", async () => {
    let readCount = 0;
    const useCase = new GetCurrentShowingListArtifact({
      reader: {
        async readCurrentArtifact() {
          readCount += 1;
          throw new Error("unexpected");
        },
      },
      repository: { async findCurrentDraft() { return null; } },
    });

    await expect(useCase.execute()).rejects.toThrow(
      CurrentShowingListDraftNotFoundError,
    );
    expect(readCount).toBe(0);
  });

  it("rejects malformed reader output", async () => {
    const useCase = new GetCurrentShowingListArtifact({
      reader: {
        async readCurrentArtifact() {
          return {
            bytes: new Uint8Array(),
            fileName: "showing-list-draft.pdf",
            mediaType: "application/pdf",
          };
        },
      },
      repository: { async findCurrentDraft() { return createCurrent(); } },
    });

    await expect(useCase.execute()).rejects.toThrow(
      ShowingListArtifactReaderInvalidResponseError,
    );
  });
});

function createCurrent(): CurrentShowingListDraft {
  const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
  return {
    artifact: {
      etag: '"artifact-etag"',
      key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    },
    createdByUserId: "0198c7d2-7668-7775-b0fc-b789690a60c2",
    deliveredAt: null,
    deliveryStatus: "pending",
    draft: {
      clientMessage: "Review before sending.",
      reviewWarnings: [],
      stops: [{
        considerations: [],
        highlights: [],
        listingId,
        orderReason: "Review this order.",
        proposedOrder: 1,
      }],
      summary: "Draft summary",
      title: "Showing List",
    },
    generatedAt: "2026-08-20T20:00:00.000Z",
    generationId: "0198c7d2-7668-7775-b0fc-b789690a60c3",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        agentInstructions: null,
        clientDisplayName: null,
        showingDate: null,
      },
    },
    generationMetadata: {
      durationMs: 1_000,
      inputTokens: null,
      model: "gpt-5.6-terra",
      outputTokens: null,
      responseId: null,
      totalTokens: null,
    },
    promptVersion: "v1",
    status: "draft",
    updatedAt: "2026-08-20T20:00:00.000Z",
  };
}
