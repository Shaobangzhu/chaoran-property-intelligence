import { z } from "zod";

import type { CurrentShowingListDraftQueryPort } from "./currentShowingListDraftRepository.js";
import type {
  DeliverCurrentShowingListDraftInput,
  DeliverCurrentShowingListDraftResult,
} from "./deliverCurrentShowingListDraft.js";
import type {
  GenerateShowingListDraftInput,
  PreparedShowingListDraft,
} from "./generateShowingListDraft.js";
import type {
  PublishCurrentShowingListDraftInput,
} from "./publishCurrentShowingListDraft.js";
import { showingListGenerationInputSchema } from "./showingListSchemas.js";

const weeklyRunInputSchema = z.strictObject({
  generationId: z.uuid(),
  actorUserId: z.uuid(),
  generatedAt: z.iso.datetime({ offset: true }),
  request: showingListGenerationInputSchema,
});

export interface RunWeeklyShowingListDraftInput {
  generationId: string;
  actorUserId: string;
  generatedAt: string;
  request: z.infer<typeof showingListGenerationInputSchema>;
}

export interface WeeklyShowingListDraftPreparerPort {
  prepare(input: GenerateShowingListDraftInput): Promise<PreparedShowingListDraft>;
}

export interface WeeklyShowingListDraftPublisherPort {
  execute(input: PublishCurrentShowingListDraftInput): Promise<unknown>;
}

export interface WeeklyShowingListDraftDeliveryPort {
  execute(
    input: DeliverCurrentShowingListDraftInput,
  ): Promise<DeliverCurrentShowingListDraftResult>;
}

export interface RunWeeklyShowingListDraftOptions {
  currentDrafts: CurrentShowingListDraftQueryPort;
  preparer: WeeklyShowingListDraftPreparerPort;
  publisher: WeeklyShowingListDraftPublisherPort;
  delivery: WeeklyShowingListDraftDeliveryPort;
}

export interface RunWeeklyShowingListDraftResult {
  publication: "published" | "reused";
  delivery: "sent" | "already-sent";
}

export class InvalidWeeklyShowingListDraftInputError extends Error {
  constructor() {
    super("Weekly Showing List configuration was invalid");
    this.name = "InvalidWeeklyShowingListDraftInputError";
  }
}

export class RunWeeklyShowingListDraft {
  constructor(private readonly options: RunWeeklyShowingListDraftOptions) {}

  async execute(
    input: RunWeeklyShowingListDraftInput,
  ): Promise<RunWeeklyShowingListDraftResult> {
    const parsedInput = weeklyRunInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new InvalidWeeklyShowingListDraftInputError();
    }
    const run = parsedInput.data;
    const current = await this.options.currentDrafts.findCurrentDraft();

    if (current?.generationId === run.generationId) {
      const delivery = await this.options.delivery.execute({
        generationId: run.generationId,
      });
      return { publication: "reused", delivery: delivery.outcome };
    }

    const prepared = await this.options.preparer.prepare({
      actorUserId: run.actorUserId,
      request: run.request,
    });
    await this.options.publisher.execute({
      generationId: run.generationId,
      actorUserId: run.actorUserId,
      generatedAt: run.generatedAt,
      generationInput: prepared.generationInput,
      listings: prepared.listings,
      draft: prepared.result.draft,
      generationMetadata: prepared.result.metadata,
    });
    const delivery = await this.options.delivery.execute({
      generationId: run.generationId,
    });
    return { publication: "published", delivery: delivery.outcome };
  }
}
