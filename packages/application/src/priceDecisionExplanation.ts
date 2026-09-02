import { z } from "zod";

import type { PriceDecisionMode } from "@chaoran-property-intelligence/domain";

import {
  normalizePriceDecisionResult,
  type PriceDecisionResult,
} from "./estimatePropertyPrice.js";
import {
  normalizePriceDecisionEvidence,
  type PriceDecisionEvidence,
} from "./priceDecisionEvidence.js";

const boundedNarrativeText = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .regex(/\S/)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const contractId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const scenarioKind = z.enum([
  "conservative",
  "recommended",
  "competitive",
  "quick-sale",
  "balanced",
  "stretch",
]);

export const priceDecisionNarrativeDraftSchema = z.strictObject({
  summary: boundedNarrativeText,
  reasons: z
    .array(
      z.strictObject({
        title: boundedNarrativeText.max(120),
        detail: boundedNarrativeText,
        evidenceIds: z.array(contractId).min(1).max(20),
      }),
    )
    .min(1)
    .max(5),
  strategySummary: boundedNarrativeText,
  strategySteps: z
    .array(
      z.strictObject({
        scenarioKind,
        guidance: boundedNarrativeText,
      }),
    )
    .length(3),
  limitationCodes: z.array(contractId).max(10),
});

type MutablePriceDecisionNarrativeDraft = z.infer<
  typeof priceDecisionNarrativeDraftSchema
>;
export type PriceDecisionNarrativeDraft =
  DeepReadonly<MutablePriceDecisionNarrativeDraft>;

export interface PriceDecisionExplanationContext {
  readonly version: "v1";
  readonly mode: PriceDecisionMode;
  readonly subject: {
    readonly propertyType: string;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareFootage: number | null;
    readonly lotSize: number | null;
    readonly yearBuilt: number | null;
  };
  readonly valuation: {
    readonly marketValueAnchor: number;
    readonly recommendedPrice: number;
    readonly rangeLow: number;
    readonly rangeHigh: number;
    readonly confidence: PriceDecisionResult["confidence"];
    readonly flexibilitySignal: PriceDecisionResult["flexibilitySignal"];
  };
  readonly comparables: readonly {
    readonly evidenceId: string;
    readonly salePrice: number;
    readonly saleDate: string;
    readonly distanceMiles: number;
    readonly propertyType: string;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareFootage: number | null;
    readonly lotSize: number | null;
    readonly yearBuilt: number | null;
    readonly similarityScore: number;
  }[];
  readonly listing: null | {
    readonly evidenceId: string;
    readonly status: string;
    readonly currentListPrice: number | null;
    readonly listedDate: string | null;
    readonly lastSeenDate: string | null;
    readonly daysOnMarket: number | null;
    readonly events: readonly {
      readonly evidenceId: string;
      readonly kind: string;
      readonly occurredOn: string;
      readonly price: number | null;
    }[];
  };
  readonly market: null | {
    readonly evidenceId: string;
    readonly zipCode: string;
    readonly lastUpdatedDate: string;
    readonly medianListPrice: number | null;
    readonly medianPricePerSquareFoot: number | null;
    readonly medianDaysOnMarket: number | null;
    readonly totalListings: number | null;
    readonly newListings: number | null;
  };
  readonly externalEstimate: null | {
    readonly evidenceId: string;
    readonly providerName: string;
    readonly estimate: number;
    readonly rangeLow: number;
    readonly rangeHigh: number;
    readonly retrievedAt: string;
  };
  readonly scenarios: readonly PriceDecisionResult["scenarios"][number][];
  readonly factors: readonly PriceDecisionResult["factors"][number][];
  readonly limitations: readonly PriceDecisionResult["limitations"][number][];
  readonly evidenceCatalogIds: readonly string[];
}

export interface PriceDecisionExplainerPort {
  explain(
    context: PriceDecisionExplanationContext,
    signal?: AbortSignal,
  ): Promise<PriceDecisionNarrativeDraft>;
}

export interface PriceDecisionExplanation {
  readonly source: "openai" | "deterministic-fallback";
  readonly enhancementUnavailable: boolean;
  readonly summary: string;
  readonly reasons: readonly {
    readonly title: string;
    readonly detail: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly strategy: {
    readonly summary: string;
    readonly steps: readonly {
      readonly scenarioKind: PriceDecisionResult["scenarios"][number]["kind"];
      readonly guidance: string;
    }[];
  };
  readonly limitations: readonly {
    readonly code: string;
    readonly message: string;
  }[];
}

export interface GeneratePriceDecisionExplanationInput {
  readonly evidence: PriceDecisionEvidence;
  readonly result: PriceDecisionResult;
}

export interface GeneratePriceDecisionExplanationOptions {
  readonly primary: PriceDecisionExplainerPort;
  readonly fallback?: PriceDecisionExplainerPort;
  readonly onFallback?: (
    reason: "provider-error" | "invalid-output",
  ) => void;
}

export class InvalidPriceDecisionExplanationContextError extends Error {
  constructor() {
    super("Price Decision explanation context was invalid");
    this.name = "InvalidPriceDecisionExplanationContextError";
  }
}

export class InvalidPriceDecisionNarrativeError extends Error {
  constructor() {
    super("Price Decision narrative was invalid");
    this.name = "InvalidPriceDecisionNarrativeError";
  }
}

export class PriceDecisionExplainerInvalidOutputError extends Error {
  constructor(message = "Price Decision explainer output was invalid") {
    super(message);
    this.name = "PriceDecisionExplainerInvalidOutputError";
  }
}

export function buildPriceDecisionExplanationContext(input: {
  readonly evidence: PriceDecisionEvidence;
  readonly result: PriceDecisionResult;
}): PriceDecisionExplanationContext {
  try {
    const evidence = normalizePriceDecisionEvidence(input.evidence);
    const result = normalizePriceDecisionResult(input.result);
    assertResultMatchesEvidence(evidence, result);

    const salesById = new Map(
      evidence.recordedSales.map((sale) => [sale.evidenceId, sale]),
    );
    const comparables = result.scoredComparables.map((scored) => {
      const sale = salesById.get(scored.evidenceId);
      if (sale === undefined) throw new Error("missing comparable");
      return {
        evidenceId: sale.evidenceId,
        salePrice: sale.salePrice,
        saleDate: sale.saleDate,
        distanceMiles: sale.distanceMiles,
        propertyType: sale.propertyType,
        bedrooms: sale.bedrooms,
        bathrooms: sale.bathrooms,
        squareFootage: sale.squareFootage,
        lotSize: sale.lotSize,
        yearBuilt: sale.yearBuilt,
        similarityScore: scored.similarityScore,
      };
    });

    const referencedIds = new Set(
      result.factors.flatMap((factor) => factor.evidenceIds),
    );
    const listing =
      evidence.targetListing === null ||
      !hasAnyListingReference(evidence, referencedIds)
        ? null
        : {
            evidenceId: evidence.targetListing.evidenceId,
            status: evidence.targetListing.status,
            currentListPrice: evidence.targetListing.currentListPrice,
            listedDate: evidence.targetListing.listedDate,
            lastSeenDate: evidence.targetListing.lastSeenDate,
            daysOnMarket: evidence.targetListing.daysOnMarket,
            events: evidence.targetListing.events
              .filter((event) => referencedIds.has(event.evidenceId))
              .map((event) => ({ ...event })),
          };
    const market =
      evidence.marketContext !== null &&
      referencedIds.has(evidence.marketContext.evidenceId)
        ? { ...evidence.marketContext }
        : null;
    const externalEstimate =
      evidence.externalValueEstimate !== null &&
      referencedIds.has(evidence.externalValueEstimate.evidenceId)
        ? { ...evidence.externalValueEstimate }
        : null;

    return deepFreeze({
      version: "v1" as const,
      mode: result.mode,
      subject: {
        propertyType: evidence.subject.propertyType,
        bedrooms: evidence.subject.bedrooms,
        bathrooms: evidence.subject.bathrooms,
        squareFootage: evidence.subject.squareFootage,
        lotSize: evidence.subject.lotSize,
        yearBuilt: evidence.subject.yearBuilt,
      },
      valuation: {
        marketValueAnchor: result.marketValueAnchor,
        recommendedPrice: result.recommendedPrice,
        rangeLow: result.rangeLow,
        rangeHigh: result.rangeHigh,
        confidence: result.confidence,
        flexibilitySignal: result.flexibilitySignal,
      },
      comparables,
      listing,
      market,
      externalEstimate,
      scenarios: result.scenarios.map((scenario) => ({ ...scenario })),
      factors: result.factors.map((factor) => ({
        ...factor,
        evidenceIds: [...factor.evidenceIds],
      })),
      limitations: result.limitations.map((limitation) => ({ ...limitation })),
      evidenceCatalogIds: [...referencedIds].sort(),
    });
  } catch (error) {
    if (error instanceof InvalidPriceDecisionExplanationContextError) {
      throw error;
    }
    throw new InvalidPriceDecisionExplanationContextError();
  }
}

export function normalizePriceDecisionNarrativeDraft(
  value: unknown,
  context: PriceDecisionExplanationContext,
): PriceDecisionNarrativeDraft {
  const parsed = priceDecisionNarrativeDraftSchema.safeParse(value);
  if (!parsed.success) return throwInvalidNarrative();

  const draft = parsed.data;
  const evidenceIds = new Set(context.evidenceCatalogIds);
  const limitationCodes = new Set(
    context.limitations.map((limitation) => limitation.code),
  );
  const expectedScenarios = context.scenarios.map((scenario) => scenario.kind);
  const receivedScenarios = draft.strategySteps.map(
    (step) => step.scenarioKind,
  );

  if (
    draft.reasons.some(
      (reason) =>
        hasDuplicates(reason.evidenceIds) ||
        reason.evidenceIds.some((id) => !evidenceIds.has(id)),
    ) ||
    hasDuplicates(draft.limitationCodes) ||
    draft.limitationCodes.some((code) => !limitationCodes.has(code)) ||
    draft.limitationCodes.length !== limitationCodes.size ||
    [...limitationCodes].some((code) => !draft.limitationCodes.includes(code)) ||
    hasDuplicates(receivedScenarios) ||
    receivedScenarios.length !== expectedScenarios.length ||
    receivedScenarios.some((kind) => !expectedScenarios.includes(kind))
  ) {
    return throwInvalidNarrative();
  }

  const trustedNarrativeText = collectTrustedNarrativeText(context);
  const trustedNumberTokens = new Set(
    [...trustedNarrativeText].flatMap(readNumberTokens),
  );
  for (const text of collectNarrativeText(draft)) {
    assertSafeNarrativeText(text, trustedNarrativeText, trustedNumberTokens);
  }

  const stepByKind = new Map(
    draft.strategySteps.map((step) => [step.scenarioKind, step]),
  );
  return deepFreeze({
    ...draft,
    reasons: draft.reasons.map((reason) => ({
      ...reason,
      evidenceIds: [...reason.evidenceIds],
    })),
    strategySteps: expectedScenarios.map((kind) => {
      const step = stepByKind.get(kind);
      if (step === undefined) return throwInvalidNarrative();
      return { ...step };
    }),
    limitationCodes: [...draft.limitationCodes],
  });
}

export class DeterministicPriceDecisionExplainer
  implements PriceDecisionExplainerPort
{
  async explain(
    context: PriceDecisionExplanationContext,
  ): Promise<PriceDecisionNarrativeDraft> {
    return normalizePriceDecisionNarrativeDraft(
      {
        summary:
          "The deterministic valuation and supplied evidence support the displayed recommendation and range.",
        reasons: context.factors.slice(0, 5).map((factor) => ({
          title: factor.title,
          detail: factor.detail,
          evidenceIds: factor.evidenceIds,
        })),
        strategySummary:
          context.mode === "offer"
            ? "Select an offer position based on negotiation risk tolerance."
            : "Select a listing position based on timing and pricing tradeoffs.",
        strategySteps: context.scenarios.map((scenario) => ({
          scenarioKind: scenario.kind,
          guidance: scenario.tradeoff,
        })),
        limitationCodes: context.limitations.map(({ code }) => code),
      },
      context,
    );
  }
}

export class GeneratePriceDecisionExplanation {
  private readonly fallback: PriceDecisionExplainerPort;

  constructor(private readonly options: GeneratePriceDecisionExplanationOptions) {
    this.fallback = options.fallback ?? new DeterministicPriceDecisionExplainer();
  }

  async execute(
    input: GeneratePriceDecisionExplanationInput,
    signal?: AbortSignal,
  ): Promise<PriceDecisionExplanation> {
    const context = buildPriceDecisionExplanationContext(input);

    try {
      const candidate = await this.options.primary.explain(context, signal);
      const draft = normalizePriceDecisionNarrativeDraft(candidate, context);
      return createExplanation("openai", false, draft, context);
    } catch (error) {
      const reason =
        error instanceof InvalidPriceDecisionNarrativeError ||
        error instanceof PriceDecisionExplainerInvalidOutputError
          ? "invalid-output"
          : "provider-error";
      notifyFallback(this.options.onFallback, reason);
      const fallbackDraft = normalizePriceDecisionNarrativeDraft(
        await this.fallback.explain(context, signal),
        context,
      );
      return createExplanation(
        "deterministic-fallback",
        true,
        fallbackDraft,
        context,
      );
    }
  }
}

function createExplanation(
  source: PriceDecisionExplanation["source"],
  enhancementUnavailable: boolean,
  draft: PriceDecisionNarrativeDraft,
  context: PriceDecisionExplanationContext,
): PriceDecisionExplanation {
  const limitationsByCode = new Map(
    context.limitations.map((limitation) => [limitation.code, limitation]),
  );
  const limitations = draft.limitationCodes.map((code) => {
    const limitation = limitationsByCode.get(code);
    if (limitation === undefined) return throwInvalidNarrative();
    return { ...limitation };
  });
  if (enhancementUnavailable) {
    limitations.push({
      code: "narrative-enhancement-unavailable",
      message:
        "Automated narrative enhancement was unavailable; deterministic wording is shown.",
    });
  }

  return deepFreeze({
    source,
    enhancementUnavailable,
    summary: draft.summary,
    reasons: draft.reasons.map((reason) => ({
      ...reason,
      evidenceIds: [...reason.evidenceIds],
    })),
    strategy: {
      summary: draft.strategySummary,
      steps: draft.strategySteps.map((step) => ({ ...step })),
    },
    limitations,
  });
}

function assertResultMatchesEvidence(
  evidence: PriceDecisionEvidence,
  result: PriceDecisionResult,
): void {
  if (result.subjectPropertyId !== evidence.subject.propertyId) {
    throw new InvalidPriceDecisionExplanationContextError();
  }
  const availableIds = collectEvidenceIds(evidence);
  if (
    result.scoredComparables.some(({ evidenceId }) => !availableIds.has(evidenceId)) ||
    result.factors.some((factor) =>
      factor.evidenceIds.some((evidenceId) => !availableIds.has(evidenceId)),
    )
  ) {
    throw new InvalidPriceDecisionExplanationContextError();
  }
}

function collectEvidenceIds(evidence: PriceDecisionEvidence): Set<string> {
  const ids = new Set(evidence.recordedSales.map(({ evidenceId }) => evidenceId));
  if (evidence.targetListing !== null) {
    ids.add(evidence.targetListing.evidenceId);
    for (const event of evidence.targetListing.events) ids.add(event.evidenceId);
  }
  if (evidence.marketContext !== null) ids.add(evidence.marketContext.evidenceId);
  if (evidence.externalValueEstimate !== null) {
    ids.add(evidence.externalValueEstimate.evidenceId);
  }
  return ids;
}

function hasAnyListingReference(
  evidence: PriceDecisionEvidence,
  referencedIds: ReadonlySet<string>,
): boolean {
  if (evidence.targetListing === null) return false;
  return (
    referencedIds.has(evidence.targetListing.evidenceId) ||
    evidence.targetListing.events.some((event) =>
      referencedIds.has(event.evidenceId),
    )
  );
}

function collectNarrativeText(
  draft: MutablePriceDecisionNarrativeDraft,
): string[] {
  return [
    draft.summary,
    draft.strategySummary,
    ...draft.reasons.flatMap((reason) => [reason.title, reason.detail]),
    ...draft.strategySteps.map((step) => step.guidance),
  ];
}

function collectTrustedNarrativeText(
  context: PriceDecisionExplanationContext,
): ReadonlySet<string> {
  return new Set([
    ...context.factors.flatMap((factor) => [factor.title, factor.detail]),
    ...context.scenarios.flatMap((scenario) => [scenario.label, scenario.tradeoff]),
    ...context.limitations.map((limitation) => limitation.message),
  ]);
}

function assertSafeNarrativeText(
  text: string,
  trustedNarrativeText: ReadonlySet<string>,
  trustedNumberTokens: ReadonlySet<string>,
): void {
  if (trustedNarrativeText.has(text)) return;
  if (
    /[$%]/.test(text) ||
    /\bUSD\b/i.test(text) ||
    /\b(?:desperate|motivated seller|seller is motivated|must sell|needs? to sell|financial pressure|time pressure|urgent seller)\b/i.test(
      text,
    ) ||
    /\bseller\b.{0,80}\b(?:desperate|motivated|urgent|must|need(?:s)?|pressure|distress|forced|wants? to sell)\b/i.test(
      text,
    ) ||
    readNumberTokens(text).some((token) => !trustedNumberTokens.has(token))
  ) {
    throwInvalidNarrative();
  }
}

function readNumberTokens(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

function notifyFallback(
  listener: GeneratePriceDecisionExplanationOptions["onFallback"],
  reason: "provider-error" | "invalid-output",
): void {
  try {
    listener?.(reason);
  } catch {
    // Observability callbacks must not change product behavior.
  }
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function throwInvalidNarrative(): never {
  throw new InvalidPriceDecisionNarrativeError();
}
