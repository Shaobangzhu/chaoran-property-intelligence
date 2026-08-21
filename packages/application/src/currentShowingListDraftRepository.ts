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
const reviewMutationIdentityShape = {
  generationId: uuidSchema,
  expectedUpdatedAt: timestampSchema,
  updatedAt: timestampSchema,
};

const deliveryMutationIdentityShape = {
  generationId: uuidSchema,
  expectedUpdatedAt: timestampSchema,
};

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

export const saveCurrentShowingListDraftInputSchema = z.strictObject({
  ...reviewMutationIdentityShape,
  draft: generatedShowingListSchema,
});

export const markCurrentShowingListDraftReviewedInputSchema = z.strictObject({
  ...reviewMutationIdentityShape,
});

export const markCurrentShowingListDraftDeliveryFailedInputSchema =
  z.strictObject({
    ...deliveryMutationIdentityShape,
    updatedAt: timestampSchema,
  });

export const markCurrentShowingListDraftDeliverySentInputSchema =
  z.strictObject({
    ...deliveryMutationIdentityShape,
    deliveredAt: timestampSchema,
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
export type SaveCurrentShowingListDraftPersistenceInput = z.infer<
  typeof saveCurrentShowingListDraftInputSchema
>;
export type MarkCurrentShowingListDraftReviewedPersistenceInput = z.infer<
  typeof markCurrentShowingListDraftReviewedInputSchema
>;
export type MarkCurrentShowingListDraftDeliveryFailedPersistenceInput = z.infer<
  typeof markCurrentShowingListDraftDeliveryFailedInputSchema
>;
export type MarkCurrentShowingListDraftDeliverySentPersistenceInput = z.infer<
  typeof markCurrentShowingListDraftDeliverySentInputSchema
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

export interface CurrentShowingListDraftQueryPort {
  findCurrentDraft(): Promise<CurrentShowingListDraft | null>;
}

export interface CurrentShowingListDraftRepositoryPort
  extends CurrentShowingListDraftQueryPort {
  replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft>;
}

export interface CurrentShowingListDraftReviewRepositoryPort
  extends CurrentShowingListDraftQueryPort {
  saveCurrentDraft(
    input: SaveCurrentShowingListDraftPersistenceInput,
  ): Promise<CurrentShowingListDraft | null>;
  markCurrentDraftReviewed(
    input: MarkCurrentShowingListDraftReviewedPersistenceInput,
  ): Promise<CurrentShowingListDraft | null>;
}

export interface CurrentShowingListDraftDeliveryRepositoryPort
  extends CurrentShowingListDraftQueryPort {
  markCurrentDraftDeliveryFailed(
    input: MarkCurrentShowingListDraftDeliveryFailedPersistenceInput,
  ): Promise<CurrentShowingListDraft | null>;
  markCurrentDraftDeliverySent(
    input: MarkCurrentShowingListDraftDeliverySentPersistenceInput,
  ): Promise<CurrentShowingListDraft | null>;
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

export function safeParseSaveCurrentShowingListDraftInput(value: unknown) {
  return saveCurrentShowingListDraftInputSchema.safeParse(value);
}

export function safeParseMarkCurrentShowingListDraftReviewedInput(
  value: unknown,
) {
  return markCurrentShowingListDraftReviewedInputSchema.safeParse(value);
}

export function safeParseMarkCurrentShowingListDraftDeliveryFailedInput(
  value: unknown,
) {
  return markCurrentShowingListDraftDeliveryFailedInputSchema.safeParse(value);
}

export function safeParseMarkCurrentShowingListDraftDeliverySentInput(
  value: unknown,
) {
  return markCurrentShowingListDraftDeliverySentInputSchema.safeParse(value);
}

function boundedString(maximumLength: number) {
  return z.string().min(1).max(maximumLength).regex(/\S/);
}
