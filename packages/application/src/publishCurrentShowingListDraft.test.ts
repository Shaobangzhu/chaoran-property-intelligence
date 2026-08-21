import { describe, expect, it } from "vitest";

import {
  CurrentShowingListGenerationConflictError,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftRepositoryPort,
  type ReplaceCurrentShowingListDraftInput,
} from "./currentShowingListDraftRepository.js";
import type { PreparedShowingListDraft } from "./generateShowingListDraft.js";
import type {
  RenderedShowingListArtifact,
  ShowingListArtifactRendererPort,
  ShowingListArtifactRenderInput,
} from "./showingListArtifactRenderer.js";
import type {
  ShowingListArtifactStorePort,
  StoredShowingListArtifact,
} from "./showingListArtifactStore.js";
import {
  InvalidShowingListPublicationInputError,
  InvalidShowingListPublicationResultError,
  PublishCurrentShowingListDraft,
  type PublishCurrentShowingListDraftInput,
} from "./publishCurrentShowingListDraft.js";

const actorUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const generationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const firstListingId = "11111111-1111-4111-8111-111111111111";
const secondListingId = "22222222-2222-4222-8222-222222222222";
const generatedAt = "2026-08-21T15:30:00.000Z";

describe("PublishCurrentShowingListDraft", () => {
  it("renders, replaces the current object, then commits matching metadata", async () => {
    const calls: string[] = [];
    const prepared = createPreparedDraft();
    const renderer = new RecordingRenderer(createArtifact(), calls);
    const artifactStore = new RecordingArtifactStore(createStoredArtifact(), calls);
    const repository = new RecordingRepository(undefined, calls);
    const useCase = createUseCase({
      renderer,
      artifactStore,
      repository,
    });

    const current = await useCase.execute(createInput());

    expect(calls).toEqual(["render", "store", "persist"]);
    expect(renderer.calls).toEqual([
      {
        generationId,
        generatedAt,
        listings: prepared.listings,
        preferences: prepared.generationInput.preferences,
        draft: prepared.result.draft,
      },
    ]);
    expect(artifactStore.calls).toEqual([createArtifact()]);
    expect(repository.calls).toEqual([
      {
        generationId,
        createdByUserId: actorUserId,
        promptVersion: "v1",
        generationInput: prepared.generationInput,
        draft: prepared.result.draft,
        generationMetadata: prepared.result.metadata,
        artifact: createStoredArtifact(),
        generatedAt,
      },
    ]);
    expect(current).toEqual(createCurrentDraft(repository.calls[0]!));
  });

  it.each([
    ["an invalid generation ID", createInput({ generationId: "not-a-uuid" })],
    ["an invalid actor ID", createInput({ actorUserId: "not-a-uuid" })],
    ["an invalid timestamp", createInput({ generatedAt: "2026-08-21" })],
    [
      "an unknown publication field",
      Object.assign(createInput(), { apiKey: "must-not-cross-the-boundary" }),
    ],
  ])("rejects %s before rendering", async (_label, input) => {
    const renderer = new RecordingRenderer(createArtifact());
    const artifactStore = new RecordingArtifactStore(createStoredArtifact());
    const repository = new RecordingRepository();
    const useCase = createUseCase({
      renderer,
      artifactStore,
      repository,
    });

    await expect(
      useCase.execute(input as PublishCurrentShowingListDraftInput),
    ).rejects.toBeInstanceOf(InvalidShowingListPublicationInputError);
    expect(renderer.calls).toEqual([]);
    expect(artifactStore.calls).toEqual([]);
    expect(repository.calls).toEqual([]);
  });

  it("rejects invalid generation metadata before rendering", async () => {
    const prepared = createPreparedDraft();
    const renderer = new RecordingRenderer(createArtifact());
    const artifactStore = new RecordingArtifactStore(createStoredArtifact());
    const repository = new RecordingRepository();
    const useCase = createUseCase({
      renderer,
      artifactStore,
      repository,
    });

    await expect(
      useCase.execute(
        createInput({
          generationMetadata: {
            ...prepared.result.metadata,
            model: " ",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidShowingListPublicationResultError);
    expect(renderer.calls).toEqual([]);
    expect(artifactStore.calls).toEqual([]);
    expect(repository.calls).toEqual([]);
  });

  it("does not touch storage or metadata when rendering fails", async () => {
    const error = new Error("render failed");
    const renderer = new RecordingRenderer(error);
    const artifactStore = new RecordingArtifactStore(createStoredArtifact());
    const repository = new RecordingRepository();
    const useCase = createUseCase({ renderer, artifactStore, repository });

    await expect(useCase.execute(createInput())).rejects.toBe(error);
    expect(artifactStore.calls).toEqual([]);
    expect(repository.calls).toEqual([]);
  });

  it("does not commit metadata when current-object replacement fails", async () => {
    const error = new Error("storage unavailable");
    const artifactStore = new RecordingArtifactStore(error);
    const repository = new RecordingRepository();
    const useCase = createUseCase({ artifactStore, repository });

    await expect(useCase.execute(createInput())).rejects.toBe(error);
    expect(artifactStore.calls).toEqual([createArtifact()]);
    expect(repository.calls).toEqual([]);
  });

  it("rejects malformed storage metadata before repository access", async () => {
    const artifactStore = new RecordingArtifactStore({
      key: "showing-lists/history.pdf",
      etag: '"etag"',
    } as unknown as StoredShowingListArtifact);
    const repository = new RecordingRepository();
    const useCase = createUseCase({ artifactStore, repository });

    await expect(useCase.execute(createInput())).rejects.toBeInstanceOf(
      InvalidShowingListPublicationResultError,
    );
    expect(repository.calls).toEqual([]);
  });

  it("reconciles an ambiguous metadata commit by the same generation and ETag", async () => {
    const repository = new AmbiguousCommitRepository();
    const artifactStore = new RecordingArtifactStore(createStoredArtifact());
    const useCase = createUseCase({ repository, artifactStore });

    const current = await useCase.execute(createInput());

    expect(current).toEqual(repository.current);
    expect(artifactStore.calls).toHaveLength(1);
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[0]).toEqual(repository.calls[1]);
    expect(repository.current?.generationId).toBe(generationId);
    expect(repository.current?.artifact).toEqual(createStoredArtifact());
  });

  it("stops after one bounded metadata reconciliation retry", async () => {
    const error = new Error("metadata unavailable");
    const repository = new FailingRepository(error);
    const artifactStore = new RecordingArtifactStore(createStoredArtifact());
    const useCase = createUseCase({ repository, artifactStore });

    await expect(useCase.execute(createInput())).rejects.toBe(error);
    expect(artifactStore.calls).toHaveLength(1);
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls[0]).toEqual(repository.calls[1]);
  });

  it("does not retry a generation identity conflict", async () => {
    const error = new CurrentShowingListGenerationConflictError();
    const repository = new FailingRepository(error);
    const useCase = createUseCase({ repository });

    await expect(useCase.execute(createInput())).rejects.toBe(error);
    expect(repository.calls).toHaveLength(1);
  });

  it.each([
    ["malformed", {}],
    [
      "a different generation",
      createCurrentDraft(createReplacement(), {
        generationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    ],
    [
      "a different ETag",
      createCurrentDraft(createReplacement(), {
        artifact: {
          key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
          etag: '"different"',
        },
      }),
    ],
  ])("rejects %s repository output", async (_label, result) => {
    const repository = new RecordingRepository(
      result as CurrentShowingListDraft,
    );
    const useCase = createUseCase({ repository });

    await expect(useCase.execute(createInput())).rejects.toBeInstanceOf(
      InvalidShowingListPublicationResultError,
    );
  });
});

function createUseCase(
  overrides: Partial<{
    renderer: ShowingListArtifactRendererPort;
    artifactStore: ShowingListArtifactStorePort;
    repository: CurrentShowingListDraftRepositoryPort;
  }> = {},
): PublishCurrentShowingListDraft {
  return new PublishCurrentShowingListDraft({
    renderer: overrides.renderer ?? new RecordingRenderer(createArtifact()),
    artifactStore:
      overrides.artifactStore ??
      new RecordingArtifactStore(createStoredArtifact()),
    repository: overrides.repository ?? new RecordingRepository(),
  });
}

function createInput(
  overrides: Partial<PublishCurrentShowingListDraftInput> = {},
): PublishCurrentShowingListDraftInput {
  const prepared = createPreparedDraft();
  return {
    generationId,
    actorUserId,
    generatedAt,
    generationInput: prepared.generationInput,
    listings: prepared.listings,
    draft: prepared.result.draft,
    generationMetadata: prepared.result.metadata,
    ...overrides,
  };
}

function createPreparedDraft(): PreparedShowingListDraft {
  return {
    generationInput: {
      listingIds: [firstListingId, secondListingId],
      preferences: {
        clientDisplayName: "A. Buyer",
        showingDate: "2026-08-23",
        agentInstructions: "Confirm availability before sharing.",
      },
    },
    listings: [
      createListing(firstListingId, "123 Main St, Eastvale, CA 92880"),
      createListing(secondListingId, "456 Oak Ave, Chino, CA 91710"),
    ],
    result: {
      draft: {
        title: "Saturday Showing List",
        summary: "An unreviewed draft for the selected properties.",
        stops: [
          {
            listingId: secondListingId,
            proposedOrder: 1,
            orderReason: "Suggested first stop for agent review.",
            highlights: ["Four bedrooms"],
            considerations: ["Confirm showing availability"],
          },
          {
            listingId: firstListingId,
            proposedOrder: 2,
            orderReason: "Suggested second stop for agent review.",
            highlights: [],
            considerations: [],
          },
        ],
        clientMessage: "Please review these properties before the showing.",
        reviewWarnings: ["Licensed-agent review is required."],
      },
      metadata: {
        model: "gpt-5.6-terra",
        responseId: "resp_123",
        inputTokens: 100,
        outputTokens: 80,
        totalTokens: 180,
        durationMs: 1_250,
      },
    },
  };
}

function createListing(id: string, formattedAddress: string) {
  return {
    id,
    formattedAddress,
    latitude: 33.9525,
    longitude: -117.5848,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825_000,
    status: "Active",
    listedDate: "2026-08-19",
    mlsName: "CRMLS",
    mlsNumber: "IG26000001",
  };
}

function createArtifact(): RenderedShowingListArtifact {
  return {
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    mediaType: "application/pdf",
    fileName: "showing-list-draft.pdf",
  };
}

function createStoredArtifact(): StoredShowingListArtifact {
  return {
    key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    etag: '"artifact-etag"',
  };
}

function createReplacement(): ReplaceCurrentShowingListDraftInput {
  const prepared = createPreparedDraft();
  return {
    generationId,
    createdByUserId: actorUserId,
    promptVersion: "v1",
    generationInput: prepared.generationInput,
    draft: prepared.result.draft,
    generationMetadata: prepared.result.metadata,
    artifact: createStoredArtifact(),
    generatedAt,
  };
}

function createCurrentDraft(
  replacement: ReplaceCurrentShowingListDraftInput,
  overrides: Partial<CurrentShowingListDraft> = {},
): CurrentShowingListDraft {
  return {
    ...replacement,
    status: "draft",
    deliveryStatus: "pending",
    deliveredAt: null,
    updatedAt: replacement.generatedAt,
    ...overrides,
  };
}

class RecordingRenderer implements ShowingListArtifactRendererPort {
  readonly calls: ShowingListArtifactRenderInput[] = [];

  constructor(
    private readonly outcome: RenderedShowingListArtifact | Error,
    private readonly order?: string[],
  ) {}

  async render(
    input: ShowingListArtifactRenderInput,
  ): Promise<RenderedShowingListArtifact> {
    this.order?.push("render");
    this.calls.push(input);
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

class RecordingArtifactStore implements ShowingListArtifactStorePort {
  readonly calls: RenderedShowingListArtifact[] = [];

  constructor(
    private readonly outcome: StoredShowingListArtifact | Error,
    private readonly order?: string[],
  ) {}

  async replaceCurrentArtifact(
    artifact: RenderedShowingListArtifact,
  ): Promise<StoredShowingListArtifact> {
    this.order?.push("store");
    this.calls.push(artifact);
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

class RecordingRepository implements CurrentShowingListDraftRepositoryPort {
  readonly calls: ReplaceCurrentShowingListDraftInput[] = [];

  constructor(
    private readonly result?: CurrentShowingListDraft,
    private readonly order?: string[],
  ) {}

  async findCurrentDraft(): Promise<CurrentShowingListDraft | null> {
    return this.result ?? null;
  }

  async replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    this.order?.push("persist");
    this.calls.push(input);
    return this.result ?? createCurrentDraft(input);
  }
}

class AmbiguousCommitRepository
  implements CurrentShowingListDraftRepositoryPort
{
  readonly calls: ReplaceCurrentShowingListDraftInput[] = [];
  current: CurrentShowingListDraft | null = null;
  private firstResponse = true;

  async findCurrentDraft(): Promise<CurrentShowingListDraft | null> {
    return this.current;
  }

  async replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    this.calls.push(input);
    this.current ??= createCurrentDraft(input);
    if (this.firstResponse) {
      this.firstResponse = false;
      throw new Error("metadata commit outcome was unknown");
    }
    return this.current;
  }
}

class FailingRepository implements CurrentShowingListDraftRepositoryPort {
  readonly calls: ReplaceCurrentShowingListDraftInput[] = [];

  constructor(private readonly error: Error) {}

  async findCurrentDraft(): Promise<CurrentShowingListDraft | null> {
    return null;
  }

  async replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    this.calls.push(input);
    throw this.error;
  }
}
