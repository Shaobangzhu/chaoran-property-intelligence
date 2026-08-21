import {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  OpenAI,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import {
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from "openai/error";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";

import {
  buildShowingListPrompt,
  generatedShowingListSchema,
  type ShowingListContext,
  type ShowingListGenerationResult,
  type ShowingListGenerator,
} from "@chaoran-property-intelligence/application";

export const OPENAI_SHOWING_LIST_CONFIGURATION = Object.freeze({
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  maxOutputTokens: 16_000,
  timeoutMs: 120_000,
  maxRetries: 2,
  responseFormatName: "showing_list_draft",
} as const);

export interface OpenAIShowingListGeneratorOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  now?: () => number;
}

export class OpenAIShowingListAuthenticationError extends Error {
  constructor() {
    super("OpenAI authentication or access failed");
    this.name = "OpenAIShowingListAuthenticationError";
  }
}

export class OpenAIShowingListRateLimitError extends Error {
  constructor() {
    super("OpenAI rate limit was exceeded");
    this.name = "OpenAIShowingListRateLimitError";
  }
}

export class OpenAIShowingListTimeoutError extends Error {
  constructor() {
    super("OpenAI Showing List generation timed out");
    this.name = "OpenAIShowingListTimeoutError";
  }
}

export class OpenAIShowingListRefusalError extends Error {
  constructor() {
    super("OpenAI refused Showing List generation");
    this.name = "OpenAIShowingListRefusalError";
  }
}

export class OpenAIShowingListIncompleteError extends Error {
  constructor() {
    super("OpenAI returned an incomplete Showing List response");
    this.name = "OpenAIShowingListIncompleteError";
  }
}

export class OpenAIShowingListInvalidResponseError extends Error {
  constructor() {
    super("OpenAI returned an invalid Showing List response");
    this.name = "OpenAIShowingListInvalidResponseError";
  }
}

export class OpenAIShowingListUnavailableError extends Error {
  constructor() {
    super("OpenAI Showing List generation was unavailable");
    this.name = "OpenAIShowingListUnavailableError";
  }
}

export class OpenAIShowingListGenerator implements ShowingListGenerator {
  private readonly client: OpenAI;
  private readonly now: () => number;

  constructor(options: OpenAIShowingListGeneratorOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new OpenAIShowingListAuthenticationError();
    }

    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries:
        options.maxRetries ?? OPENAI_SHOWING_LIST_CONFIGURATION.maxRetries,
      timeout: options.timeoutMs ?? OPENAI_SHOWING_LIST_CONFIGURATION.timeoutMs,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.now = options.now ?? (() => Date.now());
  }

  async generate(
    context: ShowingListContext,
  ): Promise<ShowingListGenerationResult> {
    const prompt = buildShowingListPrompt(context);
    const startedAt = this.now();

    let response;
    try {
      response = await this.client.responses.parse({
        model: OPENAI_SHOWING_LIST_CONFIGURATION.model,
        reasoning: {
          effort: OPENAI_SHOWING_LIST_CONFIGURATION.reasoningEffort,
        },
        instructions: prompt.instructions,
        input: prompt.input,
        max_output_tokens: OPENAI_SHOWING_LIST_CONFIGURATION.maxOutputTokens,
        store: false,
        truncation: "disabled",
        text: {
          format: zodTextFormat(
            generatedShowingListSchema,
            OPENAI_SHOWING_LIST_CONFIGURATION.responseFormatName,
          ),
          verbosity: "low",
        },
      });
    } catch (error) {
      throw mapProviderError(error);
    }

    assertUsableResponse(response);
    const draft = response.output_parsed;
    if (draft === null) {
      throw new OpenAIShowingListInvalidResponseError();
    }

    return {
      draft,
      metadata: {
        model: response.model,
        responseId: response.id,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
        durationMs: boundedDurationMs(this.now() - startedAt),
      },
    };
  }
}

function assertUsableResponse(response: {
  status?: string;
  error: unknown;
  incomplete_details: { reason?: string } | null;
  output: ReadonlyArray<{
    type: string;
    content?: ReadonlyArray<{ type: string }>;
  }>;
}): void {
  if (hasRefusal(response.output)) {
    throw new OpenAIShowingListRefusalError();
  }

  if (response.status === "incomplete") {
    if (response.incomplete_details?.reason === "content_filter") {
      throw new OpenAIShowingListRefusalError();
    }
    throw new OpenAIShowingListIncompleteError();
  }

  if (
    response.error !== null ||
    (response.status !== undefined && response.status !== "completed")
  ) {
    throw new OpenAIShowingListUnavailableError();
  }
}

function hasRefusal(
  output: ReadonlyArray<{
    type: string;
    content?: ReadonlyArray<{ type: string }>;
  }>,
): boolean {
  return output.some(
    (item) =>
      item.type === "message" &&
      item.content?.some((content) => content.type === "refusal") === true,
  );
}

function mapProviderError(error: unknown): Error {
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return new OpenAIShowingListAuthenticationError();
  }
  if (error instanceof RateLimitError) {
    return new OpenAIShowingListRateLimitError();
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAIShowingListTimeoutError();
  }
  if (error instanceof ContentFilterFinishReasonError) {
    return new OpenAIShowingListRefusalError();
  }
  if (error instanceof LengthFinishReasonError) {
    return new OpenAIShowingListIncompleteError();
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return new OpenAIShowingListInvalidResponseError();
  }
  if (error instanceof APIError || error instanceof OpenAIError) {
    return new OpenAIShowingListUnavailableError();
  }
  return error instanceof Error
    ? error
    : new OpenAIShowingListUnavailableError();
}

function boundedDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return 0;
  }
  return Math.max(0, Math.round(durationMs));
}
