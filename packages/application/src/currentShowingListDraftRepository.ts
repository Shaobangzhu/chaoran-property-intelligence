import { z } from "zod";

import type { ShowingListGenerationMetadata } from "./showingListGenerator.js";
import {
  generatedShowingListSchema,
  showingListGenerationInputSchema,
} from "./showingListSchemas.js";

export const SHOWING_LIST_CURRENT_ARTIFACT_KEY =
  "showing-lists/current.pdf" as const;

export const SHOWING_LIST_PERSISTENCE_LIMITS = Object.freeze({
  promptVersion: 64,
  model: 200,
  providerResponseId: 200,
  artifactEtag: 256,
  tokenCount: 10_000_000,
  durationMs: 15 * 60 * 1_000,
});

export const showingListStatusSchema = z.enum(["draft", "reviewed"]);
export const showingListDeliveryStatusSchema = z.enum([
  "pending",
  "sent",
  "failed",
]);

const uuidSchema = z.uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTokenCountSchema = z
  .number()
  .int()
  .min(0)
  .max(SHOWING_LIST_PERSISTENCE_LIMITS.tokenCount)
  .nullable();
const generationMetadataSchema = z.strictObject({
  model: boundedString(SHOWING_LIST_PERSISTENCE_LIMITS.model),
  responseId: boundedString(
    SHOWING_LIST_PERSISTENCE_LIMITS.providerResponseId,
  ).nullable(),
  inputTokens: nullableTokenCountSchema,
  outputTokens: nullableTokenCountSchema,
  totalTokens: nullableTokenCountSchema,
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(SHOWING_LIST_PERSISTENCE_LIMITS.durationMs),
});
const artifactSchema = z.strictObject({
  key: z.literal(SHOWING_LIST_CURRENT_ARTIFACT_KEY),
  etag: boundedString(SHOWING_LIST_PERSISTENCE_LIMITS.artifactEtag),
});

export const replaceCurrentShowingListDraftInputSchema = z.strictObject({
  generationId: uuidSchema,
  createdByUserId: uuidSchema,
  promptVersion: boundedString(
    SHOWING_LIST_PERSISTENCE_LIMITS.promptVersion,
  ),
  generationInput: showingListGenerationInputSchema,
  draft: generatedShowingListSchema,
  generationMetadata: generationMetadataSchema,
  artifact: artifactSchema,
  generatedAt: timestampSchema,
});

export const currentShowingListDraftSchema = z
  .strictObject({
    generationId: uuidSchema,
    createdByUserId: uuidSchema,
    promptVersion: boundedString(
      SHOWING_LIST_PERSISTENCE_LIMITS.promptVersion,
    ),
    generationInput: showingListGenerationInputSchema,
    draft: generatedShowingListSchema,
    generationMetadata: generationMetadataSchema,
    artifact: artifactSchema,
    status: showingListStatusSchema,
    deliveryStatus: showingListDeliveryStatusSchema,
    deliveredAt: timestampSchema.nullable(),
    generatedAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((record, context) => {
    if ((record.deliveryStatus === "sent") !== (record.deliveredAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Sent delivery state must match its timestamp",
        path: ["deliveredAt"],
      });
    }

    if (Date.parse(record.updatedAt) < Date.parse(record.generatedAt)) {
      context.addIssue({
        code: "custom",
        message: "Updated timestamp cannot precede generation",
        path: ["updatedAt"],
      });
    }
  });

export type ShowingListStatus = z.infer<typeof showingListStatusSchema>;
export type ShowingListDeliveryStatus = z.infer<
  typeof showingListDeliveryStatusSchema
>;
export type ReplaceCurrentShowingListDraftInput = z.infer<
  typeof replaceCurrentShowingListDraftInputSchema
>;
export type CurrentShowingListDraft = z.infer<
  typeof currentShowingListDraftSchema
>;

type PersistedGenerationMetadata = z.infer<typeof generationMetadataSchema>;
type Assert<T extends true> = T;
type PersistedMetadataMatchesGenerator = Assert<
  PersistedGenerationMetadata extends ShowingListGenerationMetadata
    ? ShowingListGenerationMetadata extends PersistedGenerationMetadata
      ? true
      : false
    : false
>;
type _PersistedMetadataContract = PersistedMetadataMatchesGenerator;

export interface CurrentShowingListDraftRepositoryPort {
  findCurrentDraft(): Promise<CurrentShowingListDraft | null>;
  replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft>;
}

export class CurrentShowingListGenerationConflictError extends Error {
  constructor() {
    super("Showing List generation identity conflicted with current metadata");
    this.name = "CurrentShowingListGenerationConflictError";
  }
}

export function safeParseReplaceCurrentShowingListDraftInput(value: unknown) {
  return replaceCurrentShowingListDraftInputSchema.safeParse(value);
}

export function safeParseCurrentShowingListDraft(value: unknown) {
  return currentShowingListDraftSchema.safeParse(value);
}

function boundedString(maximumLength: number) {
  return z.string().min(1).max(maximumLength).regex(/\S/);
}
