import { describe, expect, it } from "vitest";

import {
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftReviewRepositoryPort,
  type MarkCurrentShowingListDraftReviewedPersistenceInput,
  type SaveCurrentShowingListDraftPersistenceInput,
} from "./currentShowingListDraftRepository.js";
import {
  CurrentShowingListDraftChangedError,
  GetCurrentShowingListDraft,
  InvalidShowingListReviewInputError,
  InvalidShowingListReviewResultError,
  MarkCurrentShowingListDraftReviewed,
  SaveCurrentShowingListDraft,
} from "./reviewCurrentShowingListDraft.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const generationId = "0198c7d2-7668-7775-b0fc-b789690a60c3";

describe("current Showing List review use cases", () => {
  it("loads and validates the current draft", async () => {
    const repository = new InMemoryReviewRepository(createCurrent());

    await expect(
      new GetCurrentShowingListDraft(repository).execute(),
    ).resolves.toEqual(createCurrent());
  });

  it("returns null when no current draft exists", async () => {
    const repository = new InMemoryReviewRepository(null);

    await expect(
      new GetCurrentShowingListDraft(repository).execute(),
    ).resolves.toBeNull();
  });

  it("rejects malformed current data", async () => {
    const repository = new InMemoryReviewRepository(
      asUnsafeCurrent({ ...createCurrent(), status: "published" }),
    );

    await expect(
      new GetCurrentShowingListDraft(repository).execute(),
    ).rejects.toThrow(InvalidShowingListReviewResultError);
  });

  it("saves edits with a monotonic timestamp and resets reviewed status", async () => {
    const current = createCurrent({ status: "reviewed" });
    const repository = new InMemoryReviewRepository(current);
    const editedDraft = { ...current.draft, title: "Agent-reviewed route" };
    const useCase = new SaveCurrentShowingListDraft({
      now: () => new Date("2026-08-20T19:00:00.000Z"),
      repository,
    });

    await expect(
      useCase.execute({
        draft: editedDraft,
        expectedUpdatedAt: current.updatedAt,
        generationId,
      }),
    ).resolves.toMatchObject({
      draft: editedDraft,
      status: "draft",
      updatedAt: "2026-08-20T20:00:00.001Z",
    });
    expect(repository.savedInputs).toEqual([
      {
        draft: editedDraft,
        expectedUpdatedAt: current.updatedAt,
        generationId,
        updatedAt: "2026-08-20T20:00:00.001Z",
      },
    ]);
  });

  it("rejects a stale save without mutating the repository", async () => {
    const repository = new InMemoryReviewRepository(createCurrent());
    const useCase = createSaveUseCase(repository);

    await expect(
      useCase.execute({
        draft: createCurrent().draft,
        expectedUpdatedAt: "2026-08-20T19:59:00.000Z",
        generationId,
      }),
    ).rejects.toThrow(CurrentShowingListDraftChangedError);
    expect(repository.savedInputs).toEqual([]);
  });

  it("treats malformed persistence data as an internal result error", async () => {
    const repository = new InMemoryReviewRepository(
      asUnsafeCurrent({ ...createCurrent(), status: "published" }),
    );

    await expect(
      createSaveUseCase(repository).execute({
        draft: createCurrent().draft,
        expectedUpdatedAt: createCurrent().updatedAt,
        generationId,
      }),
    ).rejects.toThrow(InvalidShowingListReviewResultError);
    expect(repository.savedInputs).toEqual([]);
  });

  it("rejects edits that change the selected listing set", async () => {
    const current = createCurrent();
    const repository = new InMemoryReviewRepository(current);
    const useCase = createSaveUseCase(repository);

    await expect(
      useCase.execute({
        draft: {
          ...current.draft,
          stops: [
            {
              ...current.draft.stops[0]!,
              listingId: "0198c7d2-7668-7775-b0fc-b789690a60ff",
            },
          ],
        },
        expectedUpdatedAt: current.updatedAt,
        generationId,
      }),
    ).rejects.toThrow(InvalidShowingListReviewInputError);
    expect(repository.savedInputs).toEqual([]);
  });

  it("maps a lost save race to a stable changed error", async () => {
    const current = createCurrent();
    const repository = new InMemoryReviewRepository(current);
    repository.loseNextSave = true;

    await expect(
      createSaveUseCase(repository).execute({
        draft: current.draft,
        expectedUpdatedAt: current.updatedAt,
        generationId,
      }),
    ).rejects.toThrow(CurrentShowingListDraftChangedError);
  });

  it("marks a draft reviewed and treats an already reviewed draft idempotently", async () => {
    const current = createCurrent();
    const repository = new InMemoryReviewRepository(current);
    const useCase = new MarkCurrentShowingListDraftReviewed({
      now: () => new Date("2026-08-20T20:05:00.000Z"),
      repository,
    });

    const reviewed = await useCase.execute({
      expectedUpdatedAt: current.updatedAt,
      generationId,
    });
    expect(reviewed).toMatchObject({
      status: "reviewed",
      updatedAt: "2026-08-20T20:05:00.000Z",
    });
    expect(repository.reviewedInputs).toHaveLength(1);

    await expect(
      useCase.execute({
        expectedUpdatedAt: reviewed.updatedAt,
        generationId,
      }),
    ).resolves.toEqual(reviewed);
    expect(repository.reviewedInputs).toHaveLength(1);
  });

  it("rejects unknown review input fields before reading persistence", async () => {
    const repository = new InMemoryReviewRepository(createCurrent());
    const useCase = new MarkCurrentShowingListDraftReviewed({
      now: () => new Date(),
      repository,
    });

    await expect(
      useCase.execute({
        expectedUpdatedAt: createCurrent().updatedAt,
        generationId,
        extra: true,
      } as never),
    ).rejects.toThrow(InvalidShowingListReviewInputError);
    expect(repository.findCount).toBe(0);
  });
});

class InMemoryReviewRepository
  implements CurrentShowingListDraftReviewRepositoryPort
{
  findCount = 0;
  loseNextSave = false;
  readonly reviewedInputs: MarkCurrentShowingListDraftReviewedPersistenceInput[] =
    [];
  readonly savedInputs: SaveCurrentShowingListDraftPersistenceInput[] = [];

  constructor(private current: CurrentShowingListDraft | null) {}

  async findCurrentDraft(): Promise<CurrentShowingListDraft | null> {
    this.findCount += 1;
    return this.current;
  }

  async saveCurrentDraft(
    input: SaveCurrentShowingListDraftPersistenceInput,
  ): Promise<CurrentShowingListDraft | null> {
    this.savedInputs.push(input);
    if (this.loseNextSave || this.current === null) {
      return null;
    }
    this.current = {
      ...this.current,
      draft: input.draft,
      status: "draft",
      updatedAt: input.updatedAt,
    };
    return this.current;
  }

  async markCurrentDraftReviewed(
    input: MarkCurrentShowingListDraftReviewedPersistenceInput,
  ): Promise<CurrentShowingListDraft | null> {
    this.reviewedInputs.push(input);
    if (this.current === null) {
      return null;
    }
    this.current = {
      ...this.current,
      status: "reviewed",
      updatedAt: input.updatedAt,
    };
    return this.current;
  }
}

function createSaveUseCase(repository: InMemoryReviewRepository) {
  return new SaveCurrentShowingListDraft({
    now: () => new Date("2026-08-20T20:05:00.000Z"),
    repository,
  });
}

function createCurrent(
  overrides: Partial<CurrentShowingListDraft> = {},
): CurrentShowingListDraft {
  return {
    artifact: {
      etag: '"artifact-etag"',
      key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    },
    createdByUserId: actorUserId,
    deliveredAt: null,
    deliveryStatus: "pending",
    draft: {
      clientMessage: "Please review these properties before the showing.",
      reviewWarnings: ["Licensed-agent review is required."],
      stops: [
        {
          considerations: ["Confirm showing availability"],
          highlights: ["Four bedrooms"],
          listingId,
          orderReason: "Suggested order for agent review.",
          proposedOrder: 1,
        },
      ],
      summary: "An unreviewed draft for the selected properties.",
      title: "Saturday Showing List",
    },
    generatedAt: "2026-08-20T20:00:00.000Z",
    generationId,
    generationInput: {
      listingIds: [listingId],
      preferences: {
        agentInstructions: null,
        clientDisplayName: "Alex",
        showingDate: "2026-08-23",
      },
    },
    generationMetadata: {
      durationMs: 1_250,
      inputTokens: 100,
      model: "gpt-5.6-terra",
      outputTokens: 80,
      responseId: "resp_123",
      totalTokens: 180,
    },
    promptVersion: "v1",
    status: "draft",
    updatedAt: "2026-08-20T20:00:00.000Z",
    ...overrides,
  };
}

function asUnsafeCurrent(value: unknown): CurrentShowingListDraft {
  return value as CurrentShowingListDraft;
}
