import { z } from "zod";

import {
  normalizePriceDecisionAddress,
  normalizePriceDecisionMode,
  priceDecisionModes,
  type PriceDecisionAddress,
  type PriceDecisionAddressInput,
  type PriceDecisionMode,
} from "@chaoran-property-intelligence/domain";

import {
  InvalidPriceDecisionEvidenceError,
  normalizePriceDecisionEvidence,
  type PriceDecisionEvidence,
  type PriceDecisionEvidencePort,
} from "./priceDecisionEvidence.js";

export const PRICE_DECISION_METHODOLOGY_VERSION =
  "cpi-price-decision-v1" as const;
export const PRICE_DECISION_PRESENTATION_INCREMENT = 1_000 as const;

const maximumMoney = 2_147_483_647;
const boundedMoneySchema = z.number().int().positive().max(maximumMoney);
const roundedMoneySchema = boundedMoneySchema.refine(
  (value) => value % PRICE_DECISION_PRESENTATION_INCREMENT === 0,
);
const boundedTextSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/\S/)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const contractIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const canonicalTimestampSchema = z
  .string()
  .max(64)
  .refine(isCanonicalTimestamp);

const scenarioKindSchema = z.enum([
  "conservative",
  "recommended",
  "competitive",
  "quick-sale",
  "balanced",
  "stretch",
]);
const scenarioSchema = z.strictObject({
  kind: scenarioKindSchema,
  price: roundedMoneySchema,
  label: boundedTextSchema,
  tradeoff: boundedTextSchema,
});
const scoredComparableSchema = z.strictObject({
  evidenceId: contractIdSchema,
  similarityScore: z.number().finite().min(0).max(1),
});
const factorSchema = z.strictObject({
  factorId: contractIdSchema,
  rank: z.number().int().min(1).max(10),
  title: boundedTextSchema,
  detail: boundedTextSchema,
  direction: z.enum(["supports-higher", "supports-lower", "neutral"]),
  impact: z.enum(["low", "medium", "high"]),
  evidenceIds: z.array(contractIdSchema).min(1).max(20),
});
const limitationSchema = z.strictObject({
  code: contractIdSchema,
  message: boundedTextSchema,
});

const priceDecisionResultSchema = z.strictObject({
  methodologyVersion: z.literal(PRICE_DECISION_METHODOLOGY_VERSION),
  mode: z.enum(priceDecisionModes),
  subjectPropertyId: z.string().trim().min(1).max(300),
  currency: z.literal("USD"),
  evaluatedAt: canonicalTimestampSchema,
  marketValueAnchor: roundedMoneySchema,
  recommendedPrice: roundedMoneySchema,
  rangeLow: roundedMoneySchema,
  rangeHigh: roundedMoneySchema,
  confidence: z.enum(["high", "medium", "low"]),
  flexibilitySignal: z.enum(["unknown", "low", "medium", "high"]),
  scenarios: z.array(scenarioSchema).length(3),
  scoredComparables: z.array(scoredComparableSchema).min(3).max(10),
  factors: z.array(factorSchema).min(1).max(10),
  limitations: z.array(limitationSchema).max(10),
});

type MutablePriceDecisionResult = z.infer<typeof priceDecisionResultSchema>;
export type PriceDecisionResult = DeepReadonly<MutablePriceDecisionResult>;
export type PriceDecisionConfidence = PriceDecisionResult["confidence"];
export type PriceDecisionScenario = PriceDecisionResult["scenarios"][number];
export type PriceDecisionFactor = PriceDecisionResult["factors"][number];
export type PriceDecisionLimitation =
  PriceDecisionResult["limitations"][number];

export interface EstimatePropertyPriceInput {
  readonly address: PriceDecisionAddressInput;
  readonly mode: PriceDecisionMode;
}

export interface PriceDecisionEngineInput {
  readonly address: PriceDecisionAddress;
  readonly mode: PriceDecisionMode;
  readonly evidence: PriceDecisionEvidence;
  readonly evaluatedAt: string;
}

export interface PriceDecisionEnginePort {
  estimate(input: PriceDecisionEngineInput): PriceDecisionResult;
}

export interface EstimatePropertyPriceOptions {
  readonly evidenceProvider: PriceDecisionEvidencePort;
  readonly engine: PriceDecisionEnginePort;
  readonly now: () => Date;
}

export interface PreparedPriceDecision {
  readonly address: PriceDecisionAddress;
  readonly evidence: PriceDecisionEvidence;
  readonly result: PriceDecisionResult;
}

export class InvalidPriceDecisionInputError extends Error {
  constructor() {
    super("Price Decision input was invalid");
    this.name = "InvalidPriceDecisionInputError";
  }
}

export class InvalidPriceDecisionClockError extends Error {
  constructor() {
    super("Price Decision clock was invalid");
    this.name = "InvalidPriceDecisionClockError";
  }
}

export class InvalidPriceDecisionEvidenceResultError extends Error {
  constructor() {
    super("Price Decision evidence result was invalid");
    this.name = "InvalidPriceDecisionEvidenceResultError";
  }
}

export class InvalidPriceDecisionResultError extends Error {
  constructor() {
    super("Price Decision result was invalid");
    this.name = "InvalidPriceDecisionResultError";
  }
}

export class InsufficientPriceDecisionEvidenceError extends Error {
  constructor() {
    super("Price Decision evidence was insufficient");
    this.name = "InsufficientPriceDecisionEvidenceError";
  }
}

export class ContradictoryPriceDecisionEvidenceError extends Error {
  constructor() {
    super("Price Decision evidence was contradictory");
    this.name = "ContradictoryPriceDecisionEvidenceError";
  }
}

const estimateInputKeys = new Set(["address", "mode"]);

export class EstimatePropertyPrice {
  constructor(private readonly options: EstimatePropertyPriceOptions) {}

  async execute(
    input: EstimatePropertyPriceInput,
    signal?: AbortSignal,
  ): Promise<PriceDecisionResult> {
    return (await this.prepare(input, signal)).result;
  }

  async prepare(
    input: EstimatePropertyPriceInput,
    signal?: AbortSignal,
  ): Promise<PreparedPriceDecision> {
    const normalizedInput = normalizeInput(input);
    readClock(this.options.now);

    const rawEvidence = await this.options.evidenceProvider.load(
      signal === undefined
        ? { address: normalizedInput.address }
        : { address: normalizedInput.address, signal },
    );
    const evidence = requireValidEvidence(rawEvidence);
    const evaluatedAt = readClock(this.options.now);
    assertEvidenceMatchesRequest(
      normalizedInput.address,
      evidence,
      evaluatedAt,
    );
    const rawResult = this.options.engine.estimate({
      address: normalizedInput.address,
      mode: normalizedInput.mode,
      evidence,
      evaluatedAt,
    });
    const result = requireValidResult(rawResult);
    assertResultMatchesContext(
      normalizedInput.mode,
      evidence,
      evaluatedAt,
      result,
    );

    return Object.freeze({
      address: normalizedInput.address,
      evidence,
      result,
    });
  }
}

export function normalizePriceDecisionResult(
  value: unknown,
): PriceDecisionResult {
  const parsed = priceDecisionResultSchema.safeParse(value);
  if (!parsed.success) {
    return throwInvalidResult();
  }

  const result = parsed.data;
  assertResultRelationships(result);
  const scenarioOrder = scenarioKindsForMode(result.mode);
  const normalized: MutablePriceDecisionResult = {
    ...result,
    scenarios: [...result.scenarios].sort(
      (left, right) =>
        scenarioOrder.indexOf(left.kind) - scenarioOrder.indexOf(right.kind),
    ),
    scoredComparables: [...result.scoredComparables].sort(
      (left, right) =>
        right.similarityScore - left.similarityScore ||
        left.evidenceId.localeCompare(right.evidenceId),
    ),
    factors: [...result.factors].sort((left, right) => left.rank - right.rank),
    limitations: [...result.limitations].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
  };
  return deepFreeze(normalized);
}

function normalizeInput(input: unknown): {
  address: PriceDecisionAddress;
  mode: PriceDecisionMode;
} {
  if (!isExactRecord(input, estimateInputKeys)) {
    return throwInvalidInput();
  }
  try {
    return Object.freeze({
      address: normalizePriceDecisionAddress(input.address),
      mode: normalizePriceDecisionMode(input.mode),
    });
  } catch {
    return throwInvalidInput();
  }
}

function requireValidEvidence(value: unknown): PriceDecisionEvidence {
  try {
    return normalizePriceDecisionEvidence(value);
  } catch (error) {
    if (error instanceof InvalidPriceDecisionEvidenceError) {
      throw new InvalidPriceDecisionEvidenceResultError();
    }
    throw error;
  }
}

function requireValidResult(value: unknown): PriceDecisionResult {
  try {
    return normalizePriceDecisionResult(value);
  } catch {
    throw new InvalidPriceDecisionResultError();
  }
}

function assertEvidenceMatchesRequest(
  address: PriceDecisionAddress,
  evidence: PriceDecisionEvidence,
  evaluatedAt: string,
): void {
  if (
    evidence.subject.state !== address.state ||
    evidence.subject.zipCode !== address.zipCode ||
    evidence.acquiredAt > evaluatedAt ||
    (evidence.marketContext !== null &&
      evidence.marketContext.zipCode !== address.zipCode)
  ) {
    throw new ContradictoryPriceDecisionEvidenceError();
  }
}

function assertResultMatchesContext(
  mode: PriceDecisionMode,
  evidence: PriceDecisionEvidence,
  evaluatedAt: string,
  result: PriceDecisionResult,
): void {
  if (
    result.mode !== mode ||
    result.subjectPropertyId !== evidence.subject.propertyId ||
    result.evaluatedAt !== evaluatedAt ||
    (evidence.targetListing === null &&
      result.flexibilitySignal !== "unknown")
  ) {
    throw new InvalidPriceDecisionResultError();
  }

  const comparableIds = new Set(
    evidence.recordedSales.map((sale) => sale.evidenceId),
  );
  if (
    result.scoredComparables.some(
      (comparable) => !comparableIds.has(comparable.evidenceId),
    )
  ) {
    throw new InvalidPriceDecisionResultError();
  }

  const evidenceIds = collectEvidenceIds(evidence);
  if (
    result.factors.some((factor) =>
      factor.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId)),
    )
  ) {
    throw new InvalidPriceDecisionResultError();
  }
}

function assertResultRelationships(result: MutablePriceDecisionResult): void {
  if (
    result.rangeLow > result.marketValueAnchor ||
    result.marketValueAnchor > result.rangeHigh ||
    result.rangeLow > result.recommendedPrice ||
    result.recommendedPrice > result.rangeHigh
  ) {
    return throwInvalidResult();
  }

  const expectedScenarioKinds = scenarioKindsForMode(result.mode);
  const scenarioByKind = new Map(
    result.scenarios.map((scenario) => [scenario.kind, scenario]),
  );
  if (
    scenarioByKind.size !== expectedScenarioKinds.length ||
    expectedScenarioKinds.some((kind) => !scenarioByKind.has(kind))
  ) {
    return throwInvalidResult();
  }

  const orderedScenarios = expectedScenarioKinds.map((kind) => {
    const scenario = scenarioByKind.get(kind);
    if (scenario === undefined) {
      return throwInvalidResult();
    }
    return scenario;
  });
  if (
    orderedScenarios.some(
      (scenario) =>
        scenario.price < result.rangeLow || scenario.price > result.rangeHigh,
    ) ||
    orderedScenarios.some(
      (scenario, index) =>
        index > 0 &&
        scenario.price < (orderedScenarios[index - 1]?.price ?? scenario.price),
    ) ||
    orderedScenarios[1]?.price !== result.recommendedPrice
  ) {
    return throwInvalidResult();
  }

  if (
    hasDuplicates(result.scoredComparables.map((item) => item.evidenceId)) ||
    hasDuplicates(result.factors.map((factor) => factor.factorId)) ||
    hasDuplicates(result.limitations.map((limitation) => limitation.code)) ||
    result.factors.some((factor) => hasDuplicates(factor.evidenceIds))
  ) {
    return throwInvalidResult();
  }

  const ranks = result.factors
    .map((factor) => factor.rank)
    .sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) {
    return throwInvalidResult();
  }

  const minimumLimitations =
    result.confidence === "low" ? 2 : result.confidence === "medium" ? 1 : 0;
  if (result.limitations.length < minimumLimitations) {
    return throwInvalidResult();
  }
}

function scenarioKindsForMode(
  mode: PriceDecisionMode,
): readonly [
  MutablePriceDecisionResult["scenarios"][number]["kind"],
  MutablePriceDecisionResult["scenarios"][number]["kind"],
  MutablePriceDecisionResult["scenarios"][number]["kind"],
] {
  return mode === "offer"
    ? ["conservative", "recommended", "competitive"]
    : ["quick-sale", "balanced", "stretch"];
}

function collectEvidenceIds(evidence: PriceDecisionEvidence): Set<string> {
  const ids = new Set(evidence.recordedSales.map((sale) => sale.evidenceId));
  if (evidence.targetListing !== null) {
    ids.add(evidence.targetListing.evidenceId);
    for (const event of evidence.targetListing.events) {
      ids.add(event.evidenceId);
    }
  }
  if (evidence.marketContext !== null) {
    ids.add(evidence.marketContext.evidenceId);
  }
  if (evidence.externalValueEstimate !== null) {
    ids.add(evidence.externalValueEstimate.evidenceId);
  }
  return ids;
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidPriceDecisionClockError();
  }
  return value.toISOString();
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isExactRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
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

function throwInvalidInput(): never {
  throw new InvalidPriceDecisionInputError();
}

function throwInvalidResult(): never {
  throw new InvalidPriceDecisionResultError();
}
