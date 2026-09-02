import { describe, expect, it, vi } from "vitest";

import {
  PRICE_DECISION_EXPLANATION_INSTRUCTIONS,
  PRICE_DECISION_EXPLANATION_PROMPT_VERSION,
  PriceDecisionExplainerInvalidOutputError,
  type PriceDecisionExplanationContext,
  type PriceDecisionNarrativeDraft,
} from "@chaoran-property-intelligence/application";

import {
  OPENAI_PRICE_DECISION_CONFIGURATION,
  OpenAIPriceDecisionAuthenticationError,
  OpenAIPriceDecisionExplainer,
  OpenAIPriceDecisionIncompleteError,
  OpenAIPriceDecisionInvalidResponseError,
  OpenAIPriceDecisionRateLimitError,
  OpenAIPriceDecisionRefusalError,
  OpenAIPriceDecisionTimeoutError,
  OpenAIPriceDecisionUnavailableError,
} from "./openAIPriceDecisionExplainer.js";

describe("OpenAIPriceDecisionExplainer", () => {
  it("keeps the approved production configuration explicit", () => {
    expect(OPENAI_PRICE_DECISION_CONFIGURATION).toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      maxOutputTokens: 2_000,
      timeoutMs: 30_000,
      maxRetries: 0,
      responseFormatName: "price_decision_narrative",
    });
  });

  it("rejects a blank API key before constructing a request", () => {
    expect(() => new OpenAIPriceDecisionExplainer({ apiKey: "   " })).toThrow(
      OpenAIPriceDecisionAuthenticationError,
    );
  });

  it("uses a single bounded Responses Structured Outputs request", async () => {
    let request: Request | undefined;
    const onTelemetry = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      request = new Request(input, init);
      return Response.json(createCompletedResponse());
    });
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_079.6);
    const explainer = new OpenAIPriceDecisionExplainer({
      apiKey: "test-openai-key",
      fetch,
      now,
      onTelemetry,
    });

    await expect(explainer.explain(createContext())).resolves.toEqual(
      createDraft(),
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(request).toBeDefined();
    if (request === undefined) throw new Error("Expected captured request");
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers.get("authorization")).toBe(
      "Bearer test-openai-key",
    );
    const body = (await request.clone().json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "low" },
      instructions: PRICE_DECISION_EXPLANATION_INSTRUCTIONS,
      max_output_tokens: 2_000,
      store: false,
      truncation: "disabled",
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "price_decision_narrative",
          strict: true,
        },
      },
    });
    expect(body).not.toHaveProperty("tools");
    const input = JSON.parse(String(body.input)) as Record<string, unknown>;
    expect(input).toEqual({
      promptVersion: PRICE_DECISION_EXPLANATION_PROMPT_VERSION,
      task: "Explain the supplied deterministic price decision.",
      normalizedContext: createContext(),
    });
    expect(JSON.stringify(input)).not.toContain("100 Test Ave");
    expect(JSON.stringify(input)).not.toContain("subject-property");
    expect(onTelemetry).toHaveBeenCalledWith({
      outcome: "success",
      model: "gpt-5.6-terra",
      durationMs: 80,
      inputTokens: 420,
      outputTokens: 180,
      totalTokens: 600,
    });
  });

  it("does not let a telemetry callback alter successful generation", async () => {
    const explainer = createExplainer(
      async () => Response.json(createCompletedResponse()),
      {
        onTelemetry: () => {
          throw new Error("telemetry detail");
        },
      },
    );

    await expect(explainer.explain(createContext())).resolves.toEqual(
      createDraft(),
    );
  });

  it("classifies dynamically unsupported claims as invalid output", async () => {
    const explainer = createExplainer(async () =>
      Response.json(
        createCompletedResponse({
          output: [
            createOutputMessage(
              JSON.stringify(
                createDraft({ summary: "Guaranteed within 42 days." }),
              ),
            ),
          ],
        }),
      ),
    );

    const error = await captureError(explainer);
    expect(error).toBeInstanceOf(OpenAIPriceDecisionInvalidResponseError);
    expect(error).toBeInstanceOf(PriceDecisionExplainerInvalidOutputError);
  });

  it("classifies a completed refusal without exposing provider text", async () => {
    const explainer = createExplainer(async () =>
      Response.json(
        createCompletedResponse({
          output: [
            {
              id: "msg_refusal",
              type: "message",
              status: "completed",
              role: "assistant",
              content: [
                {
                  type: "refusal",
                  refusal: "Provider-specific refusal detail",
                },
              ],
            },
          ],
        }),
      ),
    );

    const error = await captureError(explainer);
    expect(error).toBeInstanceOf(OpenAIPriceDecisionRefusalError);
    expect(error.message).not.toContain("Provider-specific");
  });

  it("classifies content filtering as refusal and token limits as incomplete", async () => {
    const refusal = createExplainer(async () =>
      Response.json(
        createCompletedResponse({
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          output: [],
        }),
      ),
    );
    const incomplete = createExplainer(async () =>
      Response.json(
        createCompletedResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
        }),
      ),
    );

    await expect(refusal.explain(createContext())).rejects.toThrow(
      OpenAIPriceDecisionRefusalError,
    );
    await expect(incomplete.explain(createContext())).rejects.toThrow(
      OpenAIPriceDecisionIncompleteError,
    );
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["schema-invalid JSON", JSON.stringify({ summary: "Incomplete" })],
  ])("classifies %s as invalid output", async (_label, outputText) => {
    const explainer = createExplainer(async () =>
      Response.json(
        createCompletedResponse({ output: [createOutputMessage(outputText)] }),
      ),
    );

    await expect(explainer.explain(createContext())).rejects.toThrow(
      OpenAIPriceDecisionInvalidResponseError,
    );
  });

  it.each([
    [401, OpenAIPriceDecisionAuthenticationError, "authentication"],
    [403, OpenAIPriceDecisionAuthenticationError, "authentication"],
    [429, OpenAIPriceDecisionRateLimitError, "rate-limit"],
    [500, OpenAIPriceDecisionUnavailableError, "unavailable"],
  ] as const)(
    "maps provider status %i to a bounded error and telemetry outcome",
    async (status, ErrorType, outcome) => {
      const onTelemetry = vi.fn();
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(
          {
            error: {
              message: "Provider detail must not cross the adapter boundary",
              type: "test_error",
              code: "test_code",
            },
          },
          {
            status,
            headers: { "x-request-id": "req_sensitive_provider_id" },
          },
        ),
      );
      const explainer = createExplainer(fetch, { onTelemetry });

      const error = await captureError(explainer);
      expect(error).toBeInstanceOf(ErrorType);
      expect(error.message).not.toContain("Provider detail");
      expect(error.message).not.toContain("req_sensitive_provider_id");
      expect(fetch).toHaveBeenCalledOnce();
      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({ outcome }),
      );
    },
  );

  it("maps the adapter timeout to a bounded timeout error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const request = new Request(input, init);
          request.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted by timeout", "AbortError"));
          });
        }),
    );
    const explainer = new OpenAIPriceDecisionExplainer({
      apiKey: "test-openai-key",
      fetch,
      timeoutMs: 5,
    });

    await expect(explainer.explain(createContext())).rejects.toThrow(
      OpenAIPriceDecisionTimeoutError,
    );
  });

  it("maps connection and terminal response failures to bounded unavailable errors", async () => {
    const connection = createExplainer(async () => {
      throw new TypeError("Local network detail");
    });
    const terminal = createExplainer(async () =>
      Response.json(
        createCompletedResponse({
          status: "failed",
          error: { code: "server_error", message: "Provider detail" },
          output: [],
        }),
      ),
    );

    const error = await captureError(connection);
    expect(error).toBeInstanceOf(OpenAIPriceDecisionUnavailableError);
    expect(error.message).not.toContain("Local network detail");
    await expect(terminal.explain(createContext())).rejects.toThrow(
      OpenAIPriceDecisionUnavailableError,
    );
  });
});

function createExplainer(
  fetch: typeof globalThis.fetch,
  overrides: Pick<
    ConstructorParameters<typeof OpenAIPriceDecisionExplainer>[0],
    "onTelemetry"
  > = {},
): OpenAIPriceDecisionExplainer {
  return new OpenAIPriceDecisionExplainer({
    apiKey: "test-openai-key",
    fetch,
    ...overrides,
  });
}

async function captureError(
  explainer: OpenAIPriceDecisionExplainer,
): Promise<Error> {
  try {
    await explainer.explain(createContext());
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected explanation to fail");
}

function createDraft(
  overrides: Partial<PriceDecisionNarrativeDraft> = {},
): PriceDecisionNarrativeDraft {
  return {
    summary: "Recorded sales support the central recommendation.",
    reasons: [
      {
        title: "Recorded sales",
        detail: "Comparable evidence supports the valuation anchor.",
        evidenceIds: ["sale-comp-a", "sale-comp-b", "sale-comp-c"],
      },
    ],
    strategySummary: "Choose the scenario matching negotiation risk tolerance.",
    strategySteps: [
      {
        scenarioKind: "conservative",
        guidance: "Use the lower supported position with rejection risk.",
      },
      {
        scenarioKind: "recommended",
        guidance: "Use the central evidence-backed position.",
      },
      {
        scenarioKind: "competitive",
        guidance: "Use the upper supported position when appropriate.",
      },
    ],
    limitationCodes: ["condition-unknown"],
    ...overrides,
  };
}

function createContext(): PriceDecisionExplanationContext {
  return {
    version: "v1",
    mode: "offer",
    subject: {
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2_000,
      lotSize: 5_000,
      yearBuilt: 2000,
    },
    valuation: {
      marketValueAnchor: 1_000_000,
      recommendedPrice: 990_000,
      rangeLow: 950_000,
      rangeHigh: 1_030_000,
      confidence: "medium",
      flexibilitySignal: "unknown",
    },
    comparables: [
      createComparable("sale-comp-a", 0.96),
      createComparable("sale-comp-b", 0.93),
      createComparable("sale-comp-c", 0.91),
    ],
    listing: null,
    market: null,
    externalEstimate: null,
    scenarios: [
      {
        kind: "conservative",
        price: 970_000,
        label: "Conservative",
        tradeoff: "More savings potential with greater rejection risk.",
      },
      {
        kind: "recommended",
        price: 990_000,
        label: "Recommended",
        tradeoff: "Balances price discipline and acceptance probability.",
      },
      {
        kind: "competitive",
        price: 1_010_000,
        label: "Competitive",
        tradeoff: "Improves acceptance probability at a higher price.",
      },
    ],
    factors: [
      {
        factorId: "recorded-sales",
        rank: 1,
        title: "Recorded sales",
        detail: "Selected comparable sales form the primary anchor.",
        direction: "neutral",
        impact: "high",
        evidenceIds: ["sale-comp-a", "sale-comp-b", "sale-comp-c"],
      },
    ],
    limitations: [
      {
        code: "condition-unknown",
        message: "Interior condition is not represented in supplied evidence.",
      },
    ],
    evidenceCatalogIds: ["sale-comp-a", "sale-comp-b", "sale-comp-c"],
  };
}

function createComparable(evidenceId: string, similarityScore: number) {
  return {
    evidenceId,
    salePrice: 1_000_000,
    saleDate: "2026-06-15",
    distanceMiles: 0.5,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2_000,
    lotSize: 5_000,
    yearBuilt: 2000,
    similarityScore,
  } as const;
}

function createCompletedResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "resp_price_decision_123",
    object: "response",
    created_at: 1_788_000_000,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    model: "gpt-5.6-terra",
    output: [createOutputMessage(JSON.stringify(createDraft()))],
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 420,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 180,
      output_tokens_details: { reasoning_tokens: 60 },
      total_tokens: 600,
    },
    ...overrides,
  };
}

function createOutputMessage(outputText: string): Record<string, unknown> {
  return {
    id: "msg_price_decision_123",
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: outputText,
        annotations: [],
        logprobs: [],
      },
    ],
  };
}
