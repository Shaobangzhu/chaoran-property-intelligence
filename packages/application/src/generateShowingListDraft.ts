import { z } from "zod";

import type { ListingRecord } from "./listListings.js";
import type {
  ShowingListContext,
  ShowingListGenerationResult,
  ShowingListGenerator,
  ShowingListPropertyContext,
} from "./showingListGenerator.js";
import {
  generatedShowingListSchema,
  showingListGenerationInputSchema,
  type ShowingListGenerationInput,
} from "./showingListSchemas.js";

const maximumMetadataTextLength = 200;
const maximumTokenCount = 10_000_000;
const maximumDurationMs = 15 * 60 * 1_000;

const actorIdSchema = z.uuid();
const nullableTokenCountSchema = z
  .number()
  .int()
  .min(0)
  .max(maximumTokenCount)
  .nullable();
const generationResultSchema = z.strictObject({
  draft: generatedShowingListSchema,
  metadata: z.strictObject({
    model: z.string().trim().min(1).max(maximumMetadataTextLength),
    responseId: z
      .string()
      .trim()
      .min(1)
      .max(maximumMetadataTextLength)
      .nullable(),
    inputTokens: nullableTokenCountSchema,
    outputTokens: nullableTokenCountSchema,
    totalTokens: nullableTokenCountSchema,
    durationMs: z.number().int().min(0).max(maximumDurationMs),
  }),
});

export interface ShowingListListingQueryPort {
  findActiveListingsByIds(listingIds: readonly string[]): Promise<ListingRecord[]>;
}

export interface GenerateShowingListDraftInput {
  actorUserId: string;
  request: ShowingListGenerationInput;
}

export interface GenerateShowingListDraftOptions {
  query: ShowingListListingQueryPort;
  generator: ShowingListGenerator;
}

export interface PreparedShowingListDraft {
  generationInput: ShowingListGenerationInput;
  listings: readonly ShowingListPropertyContext[];
  result: ShowingListGenerationResult;
}

export interface ShowingListDraftPreparationPort {
  prepare(
    input: GenerateShowingListDraftInput,
  ): Promise<PreparedShowingListDraft>;
}

export class InvalidShowingListGenerationInputError extends Error {
  constructor() {
    super("Showing List generation input was invalid");
    this.name = "InvalidShowingListGenerationInputError";
  }
}

export class ShowingListSelectionUnavailableError extends Error {
  constructor() {
    super("One or more selected listings were unavailable");
    this.name = "ShowingListSelectionUnavailableError";
  }
}

export class InvalidShowingListGenerationResultError extends Error {
  constructor() {
    super("Showing List generation result was invalid");
    this.name = "InvalidShowingListGenerationResultError";
  }
}

export class GenerateShowingListDraft
  implements ShowingListDraftPreparationPort
{
  private readonly query: ShowingListListingQueryPort;
  private readonly generator: ShowingListGenerator;

  constructor(options: GenerateShowingListDraftOptions) {
    this.query = options.query;
    this.generator = options.generator;
  }

  async execute(
    input: GenerateShowingListDraftInput,
  ): Promise<ShowingListGenerationResult> {
    return (await this.prepare(input)).result;
  }

  async prepare(
    input: GenerateShowingListDraftInput,
  ): Promise<PreparedShowingListDraft> {
    if (!actorIdSchema.safeParse(input.actorUserId).success) {
      throw new InvalidShowingListGenerationInputError();
    }

    const parsedRequest = showingListGenerationInputSchema.safeParse(
      input.request,
    );
    if (!parsedRequest.success) {
      throw new InvalidShowingListGenerationInputError();
    }

    const request = parsedRequest.data;
    const records = await this.query.findActiveListingsByIds(
      request.listingIds,
    );
    const orderedRecords = orderAndValidateRecords(
      request.listingIds,
      records,
    );
    const context: ShowingListContext = {
      listings: orderedRecords.map(toPropertyContext),
      preferences: request.preferences,
    };

    const rawResult = await this.generator.generate(context);
    const parsedResult = generationResultSchema.safeParse(rawResult);
    if (!parsedResult.success) {
      throw new InvalidShowingListGenerationResultError();
    }

    assertGeneratedListingSet(
      request.listingIds,
      parsedResult.data.draft.stops.map((stop) => stop.listingId),
    );
    return {
      generationInput: request,
      listings: context.listings,
      result: parsedResult.data,
    };
  }
}

function orderAndValidateRecords(
  requestedIds: readonly string[],
  records: readonly ListingRecord[],
): ListingRecord[] {
  const requestedIdSet = new Set(requestedIds);
  const recordsById = new Map<string, ListingRecord>();

  for (const record of records) {
    if (!requestedIdSet.has(record.id) || recordsById.has(record.id)) {
      throw new ShowingListSelectionUnavailableError();
    }
    recordsById.set(record.id, record);
  }

  if (recordsById.size !== requestedIds.length) {
    throw new ShowingListSelectionUnavailableError();
  }

  return requestedIds.map((id) => {
    const record = recordsById.get(id);
    if (record === undefined) {
      throw new ShowingListSelectionUnavailableError();
    }
    return record;
  });
}

function toPropertyContext(record: ListingRecord): ShowingListPropertyContext {
  const listing = record.listing;
  return {
    id: record.id,
    formattedAddress: listing.formattedAddress,
    latitude: listing.latitude,
    longitude: listing.longitude,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    price: listing.price,
    status: listing.status,
    listedDate: listing.listedDate,
    mlsName: listing.mlsName,
    mlsNumber: listing.mlsNumber,
  };
}

function assertGeneratedListingSet(
  selectedIds: readonly string[],
  generatedIds: readonly string[],
): void {
  if (selectedIds.length !== generatedIds.length) {
    throw new InvalidShowingListGenerationResultError();
  }

  const generatedIdSet = new Set(generatedIds);
  if (selectedIds.some((id) => !generatedIdSet.has(id))) {
    throw new InvalidShowingListGenerationResultError();
  }
}
