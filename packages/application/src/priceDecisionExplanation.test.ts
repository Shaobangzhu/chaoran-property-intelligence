import { describe, expect, it, vi } from "vitest";

import { DeterministicPriceDecisionEngine } from "./deterministicPriceDecisionEngine.js";
import type { PriceDecisionEngineInput } from "./estimatePropertyPrice.js";
import {
  buildPriceDecisionExplanationContext,
  DeterministicPriceDecisionExplainer,
  GeneratePriceDecisionExplanation,
  InvalidPriceDecisionExplanationContextError,
  InvalidPriceDecisionNarrativeError,
  normalizePriceDecisionNarrativeDraft,
  PriceDecisionExplainerInvalidOutputError,
  type PriceDecisionExplanationContext,
  type PriceDecisionExplainerPort,
  type PriceDecisionNarrativeDraft,
} from "./priceDecisionExplanation.js";
import {
  normalizePriceDecisionEvidence,
  type PriceDecisionEvidence,
} from "./priceDecisionEvidence.js";

const evaluatedAt = "2026-09-01T18:00:00.000Z";

describe("Price Decision explanation", () => {
  it("builds a deeply frozen minimized context without address or property IDs", () => {
    const { context } = createFixture();
    const serialized = JSON.stringify(context);

    expect(context).toMatchObject({
      version: "v1",
      mode: "offer",
      valuation: {
        marketValueAnchor: 1_000_000,
        recommendedPrice: 1_000_000,
      },
      subject: {
        propertyType: "Single Family",
        squareFootage: 2_000,
      },
    });
    expect(context.comparables).toHaveLength(5);
    expect(serialized).not.toContain("100 Test Ave");
    expect(serialized).not.toContain("subject-property");
    expect(serialized).not.toContain("Fixture Rd");
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.comparables)).toBe(true);
  });

  it("fails closed when the deterministic result belongs to another subject", () => {
    const { evidence, result } = createFixture();
    const mismatchedResult = {
      ...structuredClone(result),
      subjectPropertyId: "another-subject",
    };

    expect(() =>
      buildPriceDecisionExplanationContext({
        evidence,
        result: mismatchedResult,
      }),
    ).toThrow(InvalidPriceDecisionExplanationContextError);
  });

  it("accepts only evidence-backed reasons and the exact scenario set", () => {
    const { context } = createFixture();
    const draft = normalizePriceDecisionNarrativeDraft(
      createDraft(),
      context,
    );

    expect(draft.strategySteps.map(({ scenarioKind }) => scenarioKind)).toEqual([
      "conservative",
      "recommended",
      "competitive",
    ]);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it.each([
    [
      "unknown evidence",
      createDraft({
        reasons: [
          {
            title: "Recorded sale evidence",
            detail: "Comparable evidence supports the valuation anchor.",
            evidenceIds: ["unknown-evidence"],
          },
        ],
      }),
    ],
    [
      "unknown limitation",
      createDraft({ limitationCodes: ["invented-limitation"] }),
    ],
    ["omitted limitation", createDraft({ limitationCodes: [] })],
    [
      "duplicate scenario",
      createDraft({
        strategySteps: [
          {
            scenarioKind: "recommended",
            guidance: "Use the central evidence-backed position.",
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
      }),
    ],
    [
      "invented number",
      createDraft({ summary: "The evidence guarantees a result within 42 days." }),
    ],
    [
      "currency claim",
      createDraft({ summary: "The property is worth $1000000." }),
    ],
    [
      "seller motivation",
      createDraft({ summary: "The seller is desperate and must sell." }),
    ],
  ])("rejects %s in generated narrative", (_label, draft) => {
    const { context } = createFixture();
    expect(() => normalizePriceDecisionNarrativeDraft(draft, context)).toThrow(
      InvalidPriceDecisionNarrativeError,
    );
  });

  it("creates a deterministic fallback tied to factors and scenarios", async () => {
    const { context } = createFixture();
    const fallback = new DeterministicPriceDecisionExplainer();

    const draft = await fallback.explain(context);

    expect(draft.reasons[0]).toEqual({
      title: context.factors[0]?.title,
      detail: context.factors[0]?.detail,
      evidenceIds: context.factors[0]?.evidenceIds,
    });
    expect(draft.strategySteps).toEqual(
      context.scenarios.map((scenario) => ({
        scenarioKind: scenario.kind,
        guidance: scenario.tradeoff,
      })),
    );
    expect(draft.limitationCodes).toEqual(
      context.limitations.map(({ code }) => code),
    );
  });

  it("returns validated OpenAI narrative when the primary explainer succeeds", async () => {
    const { evidence, result } = createFixture();
    const primary = new FakeExplainer({ type: "success", draft: createDraft() });
    const generator = new GeneratePriceDecisionExplanation({ primary });

    const explanation = await generator.execute({ evidence, result });

    expect(explanation).toMatchObject({
      source: "openai",
      summary: createDraft().summary,
      enhancementUnavailable: false,
    });
    expect(primary.calls).toHaveLength(1);
    expect(explanation.limitations.map(({ code }) => code)).toEqual([
      "condition-unknown",
      "seller-flexibility-inference",
    ]);
    expect(Object.isFrozen(explanation)).toBe(true);
  });

  it("uses deterministic fallback for provider failure without losing prices", async () => {
    const { evidence, result } = createFixture();
    const onFallback = vi.fn();
    const generator = new GeneratePriceDecisionExplanation({
      primary: new FakeExplainer({
        type: "failure",
        error: new Error("provider detail"),
      }),
      onFallback,
    });

    const explanation = await generator.execute({ evidence, result });

    expect(explanation.source).toBe("deterministic-fallback");
    expect(explanation.enhancementUnavailable).toBe(true);
    expect(explanation.strategy.steps.map(({ scenarioKind }) => scenarioKind)).toEqual(
      result.scenarios.map(({ kind }) => kind),
    );
    expect(explanation.limitations.map(({ code }) => code)).toContain(
      "narrative-enhancement-unavailable",
    );
    expect(onFallback).toHaveBeenCalledWith("provider-error");
  });

  it("uses deterministic fallback for dynamically invalid model output", async () => {
    const { evidence, result } = createFixture();
    const onFallback = vi.fn();
    const generator = new GeneratePriceDecisionExplanation({
      primary: new FakeExplainer({
        type: "success",
        draft: createDraft({
          reasons: [
            {
              title: "Unsupported evidence",
              detail: "This statement is not grounded in supplied evidence.",
              evidenceIds: ["unknown-evidence"],
            },
          ],
        }),
      }),
      onFallback,
    });

    const explanation = await generator.execute({ evidence, result });

    expect(explanation.source).toBe("deterministic-fallback");
    expect(onFallback).toHaveBeenCalledWith("invalid-output");
  });

  it("classifies an adapter invalid-output error separately from availability", async () => {
    const { evidence, result } = createFixture();
    const onFallback = vi.fn();
    const generator = new GeneratePriceDecisionExplanation({
      primary: new FakeExplainer({
        type: "failure",
        error: new PriceDecisionExplainerInvalidOutputError(),
      }),
      onFallback,
    });

    await expect(generator.execute({ evidence, result })).resolves.toMatchObject({
      source: "deterministic-fallback",
    });
    expect(onFallback).toHaveBeenCalledWith("invalid-output");
  });

  it("does not let fallback observability alter deterministic recovery", async () => {
    const { evidence, result } = createFixture();
    const generator = new GeneratePriceDecisionExplanation({
      primary: new FakeExplainer({
        type: "failure",
        error: new Error("provider detail"),
      }),
      onFallback: () => {
        throw new Error("observability detail");
      },
    });

    await expect(generator.execute({ evidence, result })).resolves.toMatchObject({
      source: "deterministic-fallback",
      enhancementUnavailable: true,
    });
  });
});

class FakeExplainer implements PriceDecisionExplainerPort {
  readonly calls: PriceDecisionExplanationContext[] = [];

  constructor(
    private readonly outcome:
      | { readonly type: "success"; readonly draft: PriceDecisionNarrativeDraft }
      | { readonly type: "failure"; readonly error: Error },
  ) {}

  async explain(
    context: PriceDecisionExplanationContext,
  ): Promise<PriceDecisionNarrativeDraft> {
    this.calls.push(context);
    if (this.outcome.type === "failure") throw this.outcome.error;
    return structuredClone(this.outcome.draft);
  }
}

function createDraft(
  overrides: Partial<PriceDecisionNarrativeDraft> = {},
): PriceDecisionNarrativeDraft {
  return {
    summary:
      "Recorded sales support the central recommendation while listing activity remains contextual.",
    reasons: [
      {
        title: "Recorded sale evidence",
        detail: "Comparable evidence supports the valuation anchor.",
        evidenceIds: ["sale-comp-1", "sale-comp-2", "sale-comp-3"],
      },
    ],
    strategySummary:
      "Choose the scenario that best matches negotiation risk tolerance.",
    strategySteps: [
      {
        scenarioKind: "conservative",
        guidance: "Use the lower supported position with greater rejection risk.",
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
    limitationCodes: ["condition-unknown", "seller-flexibility-inference"],
    ...overrides,
  };
}

function createFixture() {
  const evidence = createEvidence();
  const engine = new DeterministicPriceDecisionEngine();
  const engineInput: PriceDecisionEngineInput = {
    address: {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      state: "CA",
      zipCode: "92618",
    },
    mode: "offer",
    evidence,
    evaluatedAt,
  };
  const result = engine.estimate(engineInput);
  return {
    evidence,
    result,
    context: buildPriceDecisionExplanationContext({ evidence, result }),
  };
}

function createEvidence(): PriceDecisionEvidence {
  return normalizePriceDecisionEvidence({
    acquiredAt: "2026-09-01T17:59:00.000Z",
    subject: {
      propertyId: "subject-property",
      formattedAddress: "100 Test Ave, Irvine, CA 92618",
      city: "Irvine",
      state: "CA",
      zipCode: "92618",
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2_000,
      lotSize: 5_000,
      yearBuilt: 2000,
      latitude: 33.65,
      longitude: -117.74,
    },
    recordedSales: Array.from({ length: 5 }, (_, index) => ({
      evidenceId: `sale-comp-${index + 1}`,
      source: "recorded-sale",
      propertyId: `comp-property-${index + 1}`,
      formattedAddress: `${201 + index} Fixture Rd, Irvine, CA 92618`,
      salePrice: 1_000_000,
      saleDate: `2026-0${index + 3}-15`,
      distanceMiles: (index + 1) * 0.1,
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2_000,
      lotSize: 5_000,
      yearBuilt: 2000,
      latitude: 33.65 + index * 0.001,
      longitude: -117.74 - index * 0.001,
    })),
    targetListing: {
      evidenceId: "target-listing",
      status: "active",
      currentListPrice: 1_030_000,
      listedDate: "2026-08-12",
      lastSeenDate: "2026-09-01",
      daysOnMarket: 20,
      events: [
        {
          evidenceId: "listing-event-1",
          kind: "listed",
          occurredOn: "2026-08-12",
          price: 1_030_000,
        },
      ],
    },
    marketContext: {
      evidenceId: "zip-market",
      zipCode: "92618",
      lastUpdatedDate: "2026-09-01",
      medianListPrice: 1_020_000,
      medianPricePerSquareFoot: 505,
      medianDaysOnMarket: 30,
      totalListings: 100,
      newListings: 20,
    },
    externalValueEstimate: {
      evidenceId: "external-avm",
      providerName: "RentCast",
      estimate: 1_000_000,
      rangeLow: 950_000,
      rangeHigh: 1_050_000,
      retrievedAt: "2026-09-01T17:58:00.000Z",
    },
  });
}
