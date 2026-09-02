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
  buildPriceDecisionExplanationPrompt,
  InvalidPriceDecisionNarrativeError,
  normalizePriceDecisionNarrativeDraft,
  PriceDecisionExplainerInvalidOutputError,
  priceDecisionNarrativeDraftSchema,
  type PriceDecisionExplanationContext,
  type PriceDecisionExplainerPort,
  type PriceDecisionNarrativeDraft,
} from "@chaoran-property-intelligence/application";

export const OPENAI_PRICE_DECISION_CONFIGURATION = Object.freeze({
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
  maxOutputTokens: 2_000,
  timeoutMs: 30_000,
  maxRetries: 0,
  responseFormatName: "price_decision_narrative",
} as const);

export type OpenAIPriceDecisionTelemetryOutcome =
  | "success"
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "refusal"
  | "incomplete"
  | "invalid-response"
  | "unavailable";

export interface OpenAIPriceDecisionTelemetry {
  readonly outcome: OpenAIPriceDecisionTelemetryOutcome;
  readonly model: typeof OPENAI_PRICE_DECISION_CONFIGURATION.model;
  readonly durationMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface OpenAIPriceDecisionExplainerOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly onTelemetry?: (event: OpenAIPriceDecisionTelemetry) => void;
}

export class OpenAIPriceDecisionAuthenticationError extends Error {
  constructor() {
    super("OpenAI authentication or access failed");
    this.name = "OpenAIPriceDecisionAuthenticationError";
  }
}

export class OpenAIPriceDecisionRateLimitError extends Error {
  constructor() {
    super("OpenAI rate limit was exceeded");
    this.name = "OpenAIPriceDecisionRateLimitError";
  }
}

export class OpenAIPriceDecisionTimeoutError extends Error {
  constructor() {
    super("OpenAI Price Decision explanation timed out");
    this.name = "OpenAIPriceDecisionTimeoutError";
  }
}

export class OpenAIPriceDecisionRefusalError extends Error {
  constructor() {
    super("OpenAI refused Price Decision explanation");
    this.name = "OpenAIPriceDecisionRefusalError";
  }
}

export class OpenAIPriceDecisionIncompleteError extends Error {
  constructor() {
    super("OpenAI returned an incomplete Price Decision explanation");
    this.name = "OpenAIPriceDecisionIncompleteError";
  }
}

export class OpenAIPriceDecisionInvalidResponseError
  extends PriceDecisionExplainerInvalidOutputError
{
  constructor() {
    super("OpenAI returned an invalid Price Decision explanation");
    this.name = "OpenAIPriceDecisionInvalidResponseError";
  }
}

export class OpenAIPriceDecisionUnavailableError extends Error {
  constructor() {
    super("OpenAI Price Decision explanation was unavailable");
    this.name = "OpenAIPriceDecisionUnavailableError";
  }
}

export class OpenAIPriceDecisionExplainer
  implements PriceDecisionExplainerPort
{
  private readonly client: OpenAI;
  private readonly now: () => number;

  constructor(private readonly options: OpenAIPriceDecisionExplainerOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new OpenAIPriceDecisionAuthenticationError();
    }

    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: OPENAI_PRICE_DECISION_CONFIGURATION.maxRetries,
      timeout:
        options.timeoutMs ?? OPENAI_PRICE_DECISION_CONFIGURATION.timeoutMs,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.now = options.now ?? (() => Date.now());
  }

  async explain(
    context: PriceDecisionExplanationContext,
    signal?: AbortSignal,
  ): Promise<PriceDecisionNarrativeDraft> {
    const prompt = buildPriceDecisionExplanationPrompt(context);
    const startedAt = this.now();

    try {
      const response = await this.client.responses.parse(
        {
          model: OPENAI_PRICE_DECISION_CONFIGURATION.model,
          reasoning: {
            effort: OPENAI_PRICE_DECISION_CONFIGURATION.reasoningEffort,
          },
          instructions: prompt.instructions,
          input: prompt.input,
          max_output_tokens:
            OPENAI_PRICE_DECISION_CONFIGURATION.maxOutputTokens,
          store: false,
          truncation: "disabled",
          text: {
            format: zodTextFormat(
              priceDecisionNarrativeDraftSchema,
              OPENAI_PRICE_DECISION_CONFIGURATION.responseFormatName,
            ),
            verbosity: "low",
          },
        },
        signal === undefined ? undefined : { signal },
      );

      assertUsableResponse(response);
      if (response.output_parsed === null) {
        throw new OpenAIPriceDecisionInvalidResponseError();
      }
      const draft = normalizePriceDecisionNarrativeDraft(
        response.output_parsed,
        context,
      );
      emitTelemetry(this.options.onTelemetry, {
        outcome: "success",
        model: OPENAI_PRICE_DECISION_CONFIGURATION.model,
        durationMs: boundedDurationMs(this.now() - startedAt),
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      });
      return draft;
    } catch (error) {
      const mapped = mapProviderError(error);
      emitTelemetry(this.options.onTelemetry, {
        outcome: telemetryOutcome(mapped),
        model: OPENAI_PRICE_DECISION_CONFIGURATION.model,
        durationMs: boundedDurationMs(this.now() - startedAt),
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      });
      throw mapped;
    }
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
    throw new OpenAIPriceDecisionRefusalError();
  }
  if (response.status === "incomplete") {
    if (response.incomplete_details?.reason === "content_filter") {
      throw new OpenAIPriceDecisionRefusalError();
    }
    throw new OpenAIPriceDecisionIncompleteError();
  }
  if (
    response.error !== null ||
    (response.status !== undefined && response.status !== "completed")
  ) {
    throw new OpenAIPriceDecisionUnavailableError();
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
  if (isAdapterError(error)) return error;
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return new OpenAIPriceDecisionAuthenticationError();
  }
  if (error instanceof RateLimitError) {
    return new OpenAIPriceDecisionRateLimitError();
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAIPriceDecisionTimeoutError();
  }
  if (error instanceof ContentFilterFinishReasonError) {
    return new OpenAIPriceDecisionRefusalError();
  }
  if (error instanceof LengthFinishReasonError) {
    return new OpenAIPriceDecisionIncompleteError();
  }
  if (
    error instanceof ZodError ||
    error instanceof SyntaxError ||
    error instanceof InvalidPriceDecisionNarrativeError
  ) {
    return new OpenAIPriceDecisionInvalidResponseError();
  }
  if (error instanceof APIError || error instanceof OpenAIError) {
    return new OpenAIPriceDecisionUnavailableError();
  }
  return new OpenAIPriceDecisionUnavailableError();
}

function isAdapterError(error: unknown): error is Error {
  return (
    error instanceof OpenAIPriceDecisionAuthenticationError ||
    error instanceof OpenAIPriceDecisionRateLimitError ||
    error instanceof OpenAIPriceDecisionTimeoutError ||
    error instanceof OpenAIPriceDecisionRefusalError ||
    error instanceof OpenAIPriceDecisionIncompleteError ||
    error instanceof OpenAIPriceDecisionInvalidResponseError ||
    error instanceof OpenAIPriceDecisionUnavailableError
  );
}

function telemetryOutcome(error: Error): OpenAIPriceDecisionTelemetryOutcome {
  if (error instanceof OpenAIPriceDecisionAuthenticationError) {
    return "authentication";
  }
  if (error instanceof OpenAIPriceDecisionRateLimitError) return "rate-limit";
  if (error instanceof OpenAIPriceDecisionTimeoutError) return "timeout";
  if (error instanceof OpenAIPriceDecisionRefusalError) return "refusal";
  if (error instanceof OpenAIPriceDecisionIncompleteError) return "incomplete";
  if (error instanceof OpenAIPriceDecisionInvalidResponseError) {
    return "invalid-response";
  }
  return "unavailable";
}

function emitTelemetry(
  listener: OpenAIPriceDecisionExplainerOptions["onTelemetry"],
  event: OpenAIPriceDecisionTelemetry,
): void {
  try {
    listener?.(Object.freeze(event));
  } catch {
    // Observability callbacks must not change product behavior.
  }
}

function boundedDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 0;
  return Math.max(0, Math.round(durationMs));
}
