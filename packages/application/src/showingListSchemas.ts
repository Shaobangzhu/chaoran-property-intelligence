import { z } from "zod";

export const SHOWING_LIST_LIMITS = Object.freeze({
  maximumListings: 10,
  clientDisplayName: 80,
  agentInstructions: 2_000,
  title: 120,
  summary: 1_200,
  orderReason: 400,
  highlightsPerListing: 4,
  highlight: 240,
  considerationsPerListing: 4,
  consideration: 240,
  clientMessage: 2_000,
  reviewWarnings: 6,
  reviewWarning: 240,
});

export const SHOWING_LIST_ARTIFACT = Object.freeze({
  mediaType: "application/pdf",
  fileName: "showing-list-draft.pdf",
});

const uuidSchema = z.uuid();
const validIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate);

const generationPreferencesSchema = z.strictObject({
  clientDisplayName: boundedOptionalInputString(
    SHOWING_LIST_LIMITS.clientDisplayName,
  ),
  showingDate: validIsoDateSchema.nullable(),
  agentInstructions: boundedOptionalInputString(
    SHOWING_LIST_LIMITS.agentInstructions,
  ),
});

export const showingListGenerationInputSchema = z
  .strictObject({
    listingIds: z
      .array(uuidSchema)
      .min(1)
      .max(SHOWING_LIST_LIMITS.maximumListings),
    preferences: generationPreferencesSchema,
  })
  .superRefine((input, context) => {
    addDuplicateIssues(input.listingIds, context, ["listingIds"]);
  });

const generatedStopSchema = z.strictObject({
  listingId: uuidSchema,
  proposedOrder: z
    .number()
    .int()
    .min(1)
    .max(SHOWING_LIST_LIMITS.maximumListings),
  orderReason: boundedGeneratedString(SHOWING_LIST_LIMITS.orderReason),
  highlights: z
    .array(boundedGeneratedString(SHOWING_LIST_LIMITS.highlight))
    .max(SHOWING_LIST_LIMITS.highlightsPerListing),
  considerations: z
    .array(boundedGeneratedString(SHOWING_LIST_LIMITS.consideration))
    .max(SHOWING_LIST_LIMITS.considerationsPerListing),
});

export const showingListStructuredOutputSchema = z.strictObject({
  title: boundedGeneratedString(SHOWING_LIST_LIMITS.title),
  summary: boundedGeneratedString(SHOWING_LIST_LIMITS.summary),
  stops: z
    .array(generatedStopSchema)
    .min(1)
    .max(SHOWING_LIST_LIMITS.maximumListings),
  clientMessage: boundedGeneratedString(SHOWING_LIST_LIMITS.clientMessage),
  reviewWarnings: z
    .array(boundedGeneratedString(SHOWING_LIST_LIMITS.reviewWarning))
    .max(SHOWING_LIST_LIMITS.reviewWarnings),
});

export const generatedShowingListSchema =
  showingListStructuredOutputSchema.superRefine((draft, context) => {
    addDuplicateIssues(
      draft.stops.map((stop) => stop.listingId),
      context,
      ["stops"],
    );

    const orders = draft.stops
      .map((stop) => stop.proposedOrder)
      .sort((left, right) => left - right);
    if (orders.some((order, index) => order !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "Proposed order must be unique and continuous from one",
        path: ["stops"],
      });
    }
  });

export type ShowingListGenerationInput = z.infer<
  typeof showingListGenerationInputSchema
>;
export type ShowingListGenerationPreferences = z.infer<
  typeof generationPreferencesSchema
>;
export type ShowingListStructuredOutput = z.infer<
  typeof showingListStructuredOutputSchema
>;
export type GeneratedShowingList = z.infer<typeof generatedShowingListSchema>;

export function safeParseShowingListGenerationInput(value: unknown) {
  return showingListGenerationInputSchema.safeParse(value);
}

export function safeParseGeneratedShowingList(value: unknown) {
  return generatedShowingListSchema.safeParse(value);
}

function boundedOptionalInputString(maximumLength: number) {
  return z.string().trim().min(1).max(maximumLength).nullable();
}

function boundedGeneratedString(maximumLength: number) {
  return z.string().min(1).max(maximumLength).regex(/\S/);
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  pathPrefix: readonly PropertyKey[],
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: "Value must be unique",
        path: [...pathPrefix, index],
      });
      continue;
    }
    seen.add(value);
  }
}
