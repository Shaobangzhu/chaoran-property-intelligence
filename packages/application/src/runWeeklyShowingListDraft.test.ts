import { describe, expect, it, vi } from "vitest";

import type { CurrentShowingListDraft } from "./currentShowingListDraftRepository.js";
import type { PreparedShowingListDraft } from "./generateShowingListDraft.js";
import {
  RunWeeklyShowingListDraft,
  type RunWeeklyShowingListDraftInput,
} from "./runWeeklyShowingListDraft.js";

const generationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const listingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("RunWeeklyShowingListDraft", () => {
  it("publishes a new generation before delivering it", async () => {
    const calls: string[] = [];
    const prepared = createPreparedDraft();
    const currentDrafts = {
      findCurrentDraft: vi.fn(async () => null),
    };
    const preparer = {
      prepare: vi.fn(async () => {
        calls.push("prepare");
        return prepared;
      }),
    };
    const publisher = {
      execute: vi.fn(async () => {
        calls.push("publish");
      }),
    };
    const delivery = {
      execute: vi.fn(async () => {
        calls.push("deliver");
        return {
          outcome: "sent" as const,
          current: createCurrentDraft(),
        };
      }),
    };
    const useCase = new RunWeeklyShowingListDraft({
      currentDrafts,
      preparer,
      publisher,
      delivery,
    });

    await expect(useCase.execute(createInput())).resolves.toEqual({
      publication: "published",
      delivery: "sent",
    });
    expect(calls).toEqual(["prepare", "publish", "deliver"]);
    expect(preparer.prepare).toHaveBeenCalledWith({
      actorUserId,
      request: prepared.generationInput,
    });
    expect(publisher.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId,
        actorUserId,
        generatedAt: "2026-08-24T15:00:00.000Z",
        generationInput: prepared.generationInput,
      }),
    );
  });

  it("reuses an already published generation without calling the model", async () => {
    const current = createCurrentDraft();
    const preparer = { prepare: vi.fn() };
    const publisher = { execute: vi.fn() };
    const delivery = {
      execute: vi.fn(async () => ({
        outcome: "already-sent" as const,
        current,
      })),
    };
    const useCase = new RunWeeklyShowingListDraft({
      currentDrafts: { findCurrentDraft: vi.fn(async () => current) },
      preparer,
      publisher,
      delivery,
    });

    await expect(useCase.execute(createInput())).resolves.toEqual({
      publication: "reused",
      delivery: "already-sent",
    });
    expect(preparer.prepare).not.toHaveBeenCalled();
    expect(publisher.execute).not.toHaveBeenCalled();
    expect(delivery.execute).toHaveBeenCalledWith({ generationId });
  });
});

function createInput(): RunWeeklyShowingListDraftInput {
  return {
    generationId,
    actorUserId,
    generatedAt: "2026-08-24T15:00:00.000Z",
    request: createPreparedDraft().generationInput,
  };
}

function createPreparedDraft(): PreparedShowingListDraft {
  return {
    generationInput: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: null,
        showingDate: null,
        agentInstructions: null,
      },
    },
    listings: [
      {
        id: listingId,
        formattedAddress: "123 Main St, Eastvale, CA 92880",
        latitude: 33.97,
        longitude: -117.56,
        propertyType: "Single Family",
        bedrooms: 4,
        bathrooms: 3,
        price: 900_000,
        status: "Active",
        listedDate: "2026-08-20",
        mlsName: null,
        mlsNumber: null,
      },
    ],
    result: {
      draft: createCurrentDraft().draft,
      metadata: createCurrentDraft().generationMetadata,
    },
  };
}

function createCurrentDraft(): CurrentShowingListDraft {
  return {
    generationId,
    createdByUserId: actorUserId,
    promptVersion: "v1",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: null,
        showingDate: null,
        agentInstructions: null,
      },
    },
    draft: {
      title: "Weekly Showing List",
      summary: "Unreviewed draft.",
      stops: [
        {
          listingId,
          proposedOrder: 1,
          orderReason: "Review the proposed order.",
          highlights: [],
          considerations: [],
        },
      ],
      clientMessage: "Review before use.",
      reviewWarnings: ["Licensed-agent review is required."],
    },
    generationMetadata: {
      model: "gpt-5.6-terra",
      responseId: "resp_123",
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      durationMs: 100,
    },
    artifact: { key: "showing-lists/current.pdf", etag: '"etag"' },
    status: "draft",
    deliveryStatus: "sent",
    deliveredAt: "2026-08-24T15:01:00.000Z",
    generatedAt: "2026-08-24T15:00:00.000Z",
    updatedAt: "2026-08-24T15:01:00.000Z",
  };
}
