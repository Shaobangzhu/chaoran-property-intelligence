import { z } from "zod";

import {
  safeParseCurrentShowingListDraft,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftQueryPort,
  type CurrentShowingListDraftReviewRepositoryPort,
} from "./currentShowingListDraftRepository.js";
import {
  generatedShowingListSchema,
  type GeneratedShowingList,
} from "./showingListSchemas.js";

const reviewIdentityShape = {
  generationId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
};
const saveInputSchema = z.strictObject({
  ...reviewIdentityShape,
  draft: generatedShowingListSchema,
});
const markReviewedInputSchema = z.strictObject(reviewIdentityShape);

export interface SaveCurrentShowingListDraftInput {
  generationId: string;
  expectedUpdatedAt: string;
  draft: GeneratedShowingList;
}

export interface MarkCurrentShowingListDraftReviewedInput {
  generationId: string;
  expectedUpdatedAt: string;
}

export interface ReviewCurrentShowingListDraftOptions {
  repository: CurrentShowingListDraftReviewRepositoryPort;
  now: () => Date;
}

export class InvalidShowingListReviewInputError extends Error {
  constructor() {
    super("Showing List review input was invalid");
    this.name = "InvalidShowingListReviewInputError";
  }
}

export class CurrentShowingListDraftChangedError extends Error {
  constructor() {
    super("Current Showing List draft changed");
    this.name = "CurrentShowingListDraftChangedError";
  }
}

export class InvalidShowingListReviewResultError extends Error {
  constructor() {
    super("Showing List review result was invalid");
    this.name = "InvalidShowingListReviewResultError";
  }
}

export class GetCurrentShowingListDraft {
  constructor(
    private readonly repository: CurrentShowingListDraftQueryPort,
  ) {}

  async execute(): Promise<CurrentShowingListDraft | null> {
    const current = await this.repository.findCurrentDraft();
    if (current === null) {
      return null;
    }

    const parsed = safeParseCurrentShowingListDraft(current);
    if (!parsed.success) {
      throw new InvalidShowingListReviewResultError();
    }
    return parsed.data;
  }
}

export class SaveCurrentShowingListDraft {
  constructor(private readonly options: ReviewCurrentShowingListDraftOptions) {}

  async execute(
    input: SaveCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    const parsedInput = saveInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new InvalidShowingListReviewInputError();
    }

    const current = await requireMatchingCurrent(
      this.options.repository,
      parsedInput.data.generationId,
      parsedInput.data.expectedUpdatedAt,
    );
    assertSameListingSet(
      current.generationInput.listingIds,
      parsedInput.data.draft.stops.map((stop) => stop.listingId),
    );
    const updatedAt = nextUpdatedAt(this.options.now, current.updatedAt);
    const saved = await this.options.repository.saveCurrentDraft({
      generationId: current.generationId,
      expectedUpdatedAt: current.updatedAt,
      draft: parsedInput.data.draft,
      updatedAt,
    });
    if (saved === null) {
      throw new CurrentShowingListDraftChangedError();
    }

    return requireReviewResult(saved, {
      generationId: current.generationId,
      updatedAt,
      status: "draft",
      draft: parsedInput.data.draft,
    });
  }
}

export class MarkCurrentShowingListDraftReviewed {
  constructor(private readonly options: ReviewCurrentShowingListDraftOptions) {}

  async execute(
    input: MarkCurrentShowingListDraftReviewedInput,
  ): Promise<CurrentShowingListDraft> {
    const parsedInput = markReviewedInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new InvalidShowingListReviewInputError();
    }

    const current = await requireMatchingCurrent(
      this.options.repository,
      parsedInput.data.generationId,
      parsedInput.data.expectedUpdatedAt,
    );
    if (current.status === "reviewed") {
      return current;
    }

    const updatedAt = nextUpdatedAt(this.options.now, current.updatedAt);
    const reviewed = await this.options.repository.markCurrentDraftReviewed({
      generationId: current.generationId,
      expectedUpdatedAt: current.updatedAt,
      updatedAt,
    });
    if (reviewed === null) {
      throw new CurrentShowingListDraftChangedError();
    }

    return requireReviewResult(reviewed, {
      generationId: current.generationId,
      updatedAt,
      status: "reviewed",
      draft: current.draft,
    });
  }
}

async function requireMatchingCurrent(
  repository: CurrentShowingListDraftQueryPort,
  generationId: string,
  expectedUpdatedAt: string,
): Promise<CurrentShowingListDraft> {
  const current = await repository.findCurrentDraft();
  if (current === null) {
    throw new CurrentShowingListDraftChangedError();
  }
  const parsed = safeParseCurrentShowingListDraft(current);
  if (!parsed.success) {
    throw new InvalidShowingListReviewResultError();
  }
  if (
    parsed.data.generationId !== generationId ||
    parsed.data.updatedAt !== expectedUpdatedAt
  ) {
    throw new CurrentShowingListDraftChangedError();
  }
  return parsed.data;
}

function requireReviewResult(
  value: CurrentShowingListDraft,
  expected: {
    generationId: string;
    updatedAt: string;
    status: CurrentShowingListDraft["status"];
    draft: GeneratedShowingList;
  },
): CurrentShowingListDraft {
  const parsed = safeParseCurrentShowingListDraft(value);
  if (
    !parsed.success ||
    parsed.data.generationId !== expected.generationId ||
    parsed.data.updatedAt !== expected.updatedAt ||
    parsed.data.status !== expected.status ||
    JSON.stringify(parsed.data.draft) !== JSON.stringify(expected.draft)
  ) {
    throw new InvalidShowingListReviewResultError();
  }
  return parsed.data;
}

function assertSameListingSet(
  selectedIds: readonly string[],
  reviewedIds: readonly string[],
): void {
  if (
    selectedIds.length !== reviewedIds.length ||
    reviewedIds.some((id) => !selectedIds.includes(id))
  ) {
    throw new InvalidShowingListReviewInputError();
  }
}

function nextUpdatedAt(now: () => Date, currentUpdatedAt: string): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Showing List review clock was invalid");
  }

  return new Date(
    Math.max(value.getTime(), Date.parse(currentUpdatedAt) + 1),
  ).toISOString();
}
