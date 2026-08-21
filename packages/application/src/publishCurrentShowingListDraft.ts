import { z } from "zod";

import {
  CurrentShowingListGenerationConflictError,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  safeParseCurrentShowingListDraft,
  safeParseReplaceCurrentShowingListDraftInput,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftRepositoryPort,
  type ReplaceCurrentShowingListDraftInput,
} from "./currentShowingListDraftRepository.js";
import type { ShowingListArtifactRendererPort } from "./showingListArtifactRenderer.js";
import type { ShowingListArtifactStorePort } from "./showingListArtifactStore.js";
import type {
  ShowingListGenerationMetadata,
  ShowingListPropertyContext,
} from "./showingListGenerator.js";
import { SHOWING_LIST_PROMPT_VERSION } from "./showingListPrompt.js";
import {
  SHOWING_LIST_LIMITS,
  showingListGenerationInputSchema,
  type GeneratedShowingList,
  type ShowingListGenerationInput,
} from "./showingListSchemas.js";

const publicationInputSchema = z.strictObject({
  generationId: z.uuid(),
  actorUserId: z.uuid(),
  generatedAt: z.iso.datetime({ offset: true }),
  generationInput: showingListGenerationInputSchema,
  listings: z
    .array(z.unknown())
    .min(1)
    .max(SHOWING_LIST_LIMITS.maximumListings),
  draft: z.unknown(),
  generationMetadata: z.unknown(),
});

const validationArtifact = Object.freeze({
  key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  etag: "pending-publication-validation",
});

export interface PublishCurrentShowingListDraftInput {
  generationId: string;
  actorUserId: string;
  generatedAt: string;
  generationInput: ShowingListGenerationInput;
  listings: readonly ShowingListPropertyContext[];
  draft: GeneratedShowingList;
  generationMetadata: ShowingListGenerationMetadata;
}

export interface PublishCurrentShowingListDraftOptions {
  renderer: ShowingListArtifactRendererPort;
  artifactStore: ShowingListArtifactStorePort;
  repository: CurrentShowingListDraftRepositoryPort;
}

export class InvalidShowingListPublicationInputError extends Error {
  constructor() {
    super("Showing List publication input was invalid");
    this.name = "InvalidShowingListPublicationInputError";
  }
}

export class InvalidShowingListPublicationResultError extends Error {
  constructor() {
    super("Showing List publication result was invalid");
    this.name = "InvalidShowingListPublicationResultError";
  }
}

export class PublishCurrentShowingListDraft {
  constructor(
    private readonly options: PublishCurrentShowingListDraftOptions,
  ) {}

  async execute(
    input: PublishCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    const parsedInput = publicationInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new InvalidShowingListPublicationInputError();
    }

    const publication = parsedInput.data;
    const pendingReplacement = safeParseReplaceCurrentShowingListDraftInput({
      generationId: publication.generationId,
      createdByUserId: publication.actorUserId,
      promptVersion: SHOWING_LIST_PROMPT_VERSION,
      generationInput: publication.generationInput,
      draft: publication.draft,
      generationMetadata: publication.generationMetadata,
      artifact: validationArtifact,
      generatedAt: publication.generatedAt,
    });
    if (!pendingReplacement.success) {
      throw new InvalidShowingListPublicationResultError();
    }

    const replacement = pendingReplacement.data;
    const renderedArtifact = await this.options.renderer.render({
      generationId: replacement.generationId,
      generatedAt: replacement.generatedAt,
      listings: publication.listings as readonly ShowingListPropertyContext[],
      preferences: replacement.generationInput.preferences,
      draft: replacement.draft,
    });
    const storedArtifact = await this.options.artifactStore.replaceCurrentArtifact(
      renderedArtifact,
    );
    const persistedReplacement = safeParseReplaceCurrentShowingListDraftInput({
      ...replacement,
      artifact: storedArtifact,
    });
    if (!persistedReplacement.success) {
      throw new InvalidShowingListPublicationResultError();
    }

    const current = await replaceMetadataWithReconciliation(
      this.options.repository,
      persistedReplacement.data,
    );
    const parsedCurrent = safeParseCurrentShowingListDraft(current);
    const expectedArtifact = persistedReplacement.data.artifact;
    if (
      !parsedCurrent.success ||
      parsedCurrent.data.generationId !==
        persistedReplacement.data.generationId ||
      parsedCurrent.data.artifact.key !== expectedArtifact.key ||
      parsedCurrent.data.artifact.etag !== expectedArtifact.etag
    ) {
      throw new InvalidShowingListPublicationResultError();
    }

    return parsedCurrent.data;
  }
}

async function replaceMetadataWithReconciliation(
  repository: CurrentShowingListDraftRepositoryPort,
  input: ReplaceCurrentShowingListDraftInput,
): Promise<CurrentShowingListDraft> {
  try {
    return await repository.replaceCurrentDraft(input);
  } catch (error) {
    if (error instanceof CurrentShowingListGenerationConflictError) {
      throw error;
    }
    return repository.replaceCurrentDraft(input);
  }
}
