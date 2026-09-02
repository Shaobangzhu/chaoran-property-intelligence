import {
  InvalidPriceDecisionAddressError,
  listingPropertyTypes,
  normalizePriceDecisionAddress,
  normalizePriceDecisionMode,
  type ListingPropertyType,
  type PriceDecisionMode,
} from "@chaoran-property-intelligence/domain";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";

const maximumMoney = 2_147_483_647;
const publicPropertyIdPattern = /^cpi-property-[a-f0-9]{24}$/;
const contractIdPattern = /^[a-z0-9][a-z0-9._:-]*$/;
const propertyTypeSet = new Set<string>(listingPropertyTypes);

export interface PriceEstimationInput {
  readonly streetAddress: string;
  readonly city: string;
  readonly zipCode: string;
  readonly mode: PriceDecisionMode;
}

export type PriceEstimationScenarioKind =
  | "conservative"
  | "recommended"
  | "competitive"
  | "quick-sale"
  | "balanced"
  | "stretch";

export interface PriceEstimationResult {
  readonly analysisId: string;
  readonly methodologyVersion: "cpi-price-decision-v1";
  readonly mode: PriceDecisionMode;
  readonly subject: {
    readonly propertyId: string;
    readonly formattedAddress: string;
    readonly propertyType: ListingPropertyType;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareFootage: number | null;
    readonly lotSize: number | null;
    readonly yearBuilt: number | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
  };
  readonly recommendation: {
    readonly recommendedPrice: number;
    readonly rangeLow: number;
    readonly rangeHigh: number;
    readonly marketValueAnchor: number;
    readonly currency: "USD";
    readonly confidence: "high" | "medium" | "low";
    readonly dataAsOf: string;
  };
  readonly scenarios: readonly {
    readonly kind: PriceEstimationScenarioKind;
    readonly price: number;
    readonly label: string;
    readonly tradeoff: string;
  }[];
  readonly reasons: readonly {
    readonly title: string;
    readonly detail: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly comparables: readonly {
    readonly evidenceId: string;
    readonly propertyId: string;
    readonly formattedAddress: string;
    readonly salePrice: number;
    readonly saleDate: string;
    readonly distanceMiles: number;
    readonly propertyType: ListingPropertyType;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareFootage: number | null;
    readonly lotSize: number | null;
    readonly yearBuilt: number | null;
    readonly pricePerSquareFoot: number | null;
    readonly similarityScore: number;
    readonly latitude: number | null;
    readonly longitude: number | null;
  }[];
  readonly context: {
    readonly avm: null | {
      readonly estimate: number;
      readonly rangeLow: number;
      readonly rangeHigh: number;
      readonly label: "RentCast value estimate";
      readonly retrievedAt: string;
    };
    readonly market: null | {
      readonly zipCode: string;
      readonly medianListPrice: number | null;
      readonly medianPricePerSquareFoot: number | null;
      readonly medianDaysOnMarket: number | null;
      readonly totalListings: number | null;
      readonly newListings: number | null;
      readonly lastUpdatedDate: string;
    };
    readonly listingSignals: null | {
      readonly currentListPrice: number | null;
      readonly daysOnMarket: number | null;
      readonly priceReductionCount: number;
      readonly totalReductionPercent: number;
      readonly flexibilitySignal: "unknown" | "low" | "medium" | "high";
      readonly isInference: true;
    };
  };
  readonly strategy: {
    readonly summary: string;
    readonly steps: readonly {
      readonly scenarioKind: PriceEstimationScenarioKind;
      readonly guidance: string;
    }[];
    readonly source: "openai" | "deterministic-fallback";
    readonly enhancementUnavailable: boolean;
  };
  readonly limitations: readonly {
    readonly code: string;
    readonly message: string;
  }[];
}

export type PriceEstimationFailureCode =
  | "property-not-found"
  | "insufficient-evidence"
  | "in-progress"
  | "rate-limited"
  | "evidence-unavailable"
  | "service-unavailable"
  | "timed-out"
  | "unexpected";

export class PriceEstimationValidationError extends Error {
  constructor(readonly field: "streetAddress" | "city" | "zipCode" | "form") {
    super("Price Estimation input was invalid");
    this.name = "PriceEstimationValidationError";
  }
}

export class PriceEstimationRequestError extends Error {
  constructor(readonly code: PriceEstimationFailureCode) {
    super("Price Estimation request failed");
    this.name = "PriceEstimationRequestError";
  }
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PriceEstimationRequestOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly signal?: AbortSignal;
}

export async function estimatePropertyPrice(
  input: PriceEstimationInput,
  options: PriceEstimationRequestOptions = {},
): Promise<PriceEstimationResult> {
  const normalized = normalizeInput(input);
  const request: RequestInit = {
    body: JSON.stringify(normalized),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  };
  if (options.signal !== undefined) request.signal = options.signal;
  const response = await (options.fetchImplementation ?? fetch)(
    "/api/price-estimations",
    request,
  );
  throwForStatus(response);
  const result = parsePriceEstimationResponse(await readJson(response));
  if (result.mode !== normalized.mode) throw invalidResponse();
  return result;
}

function normalizeInput(input: PriceEstimationInput): PriceEstimationInput {
  try {
    const address = normalizePriceDecisionAddress({
      streetAddress: input.streetAddress,
      city: input.city,
      zipCode: input.zipCode,
    });
    return {
      streetAddress: address.streetAddress,
      city: address.city,
      zipCode: address.zipCode,
      mode: normalizePriceDecisionMode(input.mode),
    };
  } catch (error) {
    const field =
      error instanceof InvalidPriceDecisionAddressError &&
      error.field !== "address"
        ? error.field
        : "form";
    throw new PriceEstimationValidationError(field);
  }
}

function throwForStatus(response: Response): void {
  if (response.status === 401) throw new SessionAuthenticationRequiredError();
  if (response.status === 400) throw new PriceEstimationValidationError("form");
  const codeByStatus: Partial<Record<number, PriceEstimationFailureCode>> = {
    404: "property-not-found",
    409: "in-progress",
    422: "insufficient-evidence",
    429: "rate-limited",
    502: "evidence-unavailable",
    503: "service-unavailable",
    504: "timed-out",
  };
  if (!response.ok) {
    throw new PriceEstimationRequestError(
      codeByStatus[response.status] ?? "unexpected",
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

export function parsePriceEstimationResponse(value: unknown): PriceEstimationResult {
  try {
    const response = strictRecord(value, [
      "analysisId",
      "methodologyVersion",
      "mode",
      "subject",
      "recommendation",
      "scenarios",
      "reasons",
      "comparables",
      "context",
      "strategy",
      "limitations",
    ]);
    const mode = readEnum(response.mode, ["offer", "listing"] as const);
    const subject = parseSubject(response.subject);
    const recommendation = parseRecommendation(response.recommendation);
    const scenarios = readArray(response.scenarios, 3, 3).map(parseScenario);
    const expectedKinds =
      mode === "offer"
        ? ["conservative", "recommended", "competitive"]
        : ["quick-sale", "balanced", "stretch"];
    if (scenarios.some((scenario, index) => scenario.kind !== expectedKinds[index])) {
      throw invalidResponse();
    }
    if (
      recommendation.rangeLow > recommendation.recommendedPrice ||
      recommendation.recommendedPrice > recommendation.rangeHigh
    ) {
      throw invalidResponse();
    }
    const comparables = readArray(response.comparables, 3, 10).map(parseComparable);
    if (new Set(comparables.map(({ evidenceId }) => evidenceId)).size !== comparables.length) {
      throw invalidResponse();
    }
    const strategy = parseStrategy(response.strategy);
    if (
      strategy.steps.length !== scenarios.length ||
      strategy.steps.some((step, index) => step.scenarioKind !== scenarios[index]?.kind)
    ) {
      throw invalidResponse();
    }
    if (
      (strategy.source === "openai" && strategy.enhancementUnavailable) ||
      (strategy.source === "deterministic-fallback" &&
        !strategy.enhancementUnavailable)
    ) {
      throw invalidResponse();
    }
    return {
      analysisId: readText(response.analysisId, 100),
      methodologyVersion: readLiteral(
        response.methodologyVersion,
        "cpi-price-decision-v1",
      ),
      mode,
      subject,
      recommendation,
      scenarios,
      reasons: readArray(response.reasons, 1, 10).map(parseReason),
      comparables,
      context: parseContext(response.context),
      strategy,
      limitations: readArray(response.limitations, 0, 10).map(parseLimitation),
    };
  } catch (error) {
    if (error instanceof PriceEstimationRequestError) throw error;
    throw invalidResponse();
  }
}

function parseSubject(value: unknown): PriceEstimationResult["subject"] {
  const subject = strictRecord(value, [
    "propertyId",
    "formattedAddress",
    "propertyType",
    "bedrooms",
    "bathrooms",
    "squareFootage",
    "lotSize",
    "yearBuilt",
    "latitude",
    "longitude",
  ]);
  const latitude = readNullableNumber(subject.latitude, -90, 90);
  const longitude = readNullableNumber(subject.longitude, -180, 180);
  if ((latitude === null) !== (longitude === null)) throw invalidResponse();
  return {
    propertyId: readPattern(subject.propertyId, publicPropertyIdPattern, 37),
    formattedAddress: readText(subject.formattedAddress, 300),
    propertyType: readPropertyType(subject.propertyType),
    bedrooms: readNullableIncrement(subject.bedrooms, 0.25, 0, 100),
    bathrooms: readNullableIncrement(subject.bathrooms, 0.25, 0, 100),
    squareFootage: readNullableInteger(subject.squareFootage, 1, 100_000),
    lotSize: readNullableInteger(subject.lotSize, 1, 100_000_000),
    yearBuilt: readNullableInteger(subject.yearBuilt, 1600, 2200),
    latitude,
    longitude,
  };
}

function parseRecommendation(
  value: unknown,
): PriceEstimationResult["recommendation"] {
  const recommendation = strictRecord(value, [
    "recommendedPrice",
    "rangeLow",
    "rangeHigh",
    "marketValueAnchor",
    "currency",
    "confidence",
    "dataAsOf",
  ]);
  return {
    recommendedPrice: readRoundedMoney(recommendation.recommendedPrice),
    rangeLow: readRoundedMoney(recommendation.rangeLow),
    rangeHigh: readRoundedMoney(recommendation.rangeHigh),
    marketValueAnchor: readRoundedMoney(recommendation.marketValueAnchor),
    currency: readLiteral(recommendation.currency, "USD"),
    confidence: readEnum(recommendation.confidence, ["high", "medium", "low"] as const),
    dataAsOf: readTimestamp(recommendation.dataAsOf),
  };
}

function parseScenario(value: unknown): PriceEstimationResult["scenarios"][number] {
  const scenario = strictRecord(value, ["kind", "price", "label", "tradeoff"]);
  return {
    kind: readEnum(scenario.kind, [
      "conservative",
      "recommended",
      "competitive",
      "quick-sale",
      "balanced",
      "stretch",
    ] as const),
    price: readRoundedMoney(scenario.price),
    label: readText(scenario.label, 500),
    tradeoff: readText(scenario.tradeoff, 500),
  };
}

function parseReason(value: unknown): PriceEstimationResult["reasons"][number] {
  const reason = strictRecord(value, ["title", "detail", "evidenceIds"]);
  return {
    title: readText(reason.title, 500),
    detail: readText(reason.detail, 500),
    evidenceIds: readArray(reason.evidenceIds, 1, 20).map(readContractId),
  };
}

function parseComparable(
  value: unknown,
): PriceEstimationResult["comparables"][number] {
  const comparable = strictRecord(value, [
    "evidenceId",
    "propertyId",
    "formattedAddress",
    "salePrice",
    "saleDate",
    "distanceMiles",
    "propertyType",
    "bedrooms",
    "bathrooms",
    "squareFootage",
    "lotSize",
    "yearBuilt",
    "pricePerSquareFoot",
    "similarityScore",
    "latitude",
    "longitude",
  ]);
  const latitude = readNullableNumber(comparable.latitude, -90, 90);
  const longitude = readNullableNumber(comparable.longitude, -180, 180);
  if ((latitude === null) !== (longitude === null)) throw invalidResponse();
  const squareFootage = readNullableInteger(comparable.squareFootage, 1, 100_000);
  const pricePerSquareFoot = readNullableNumber(
    comparable.pricePerSquareFoot,
    0.01,
    1_000_000,
  );
  const salePrice = readMoney(comparable.salePrice);
  if (
    (squareFootage === null) !== (pricePerSquareFoot === null) ||
    (squareFootage !== null &&
      pricePerSquareFoot !==
        Math.round((salePrice / squareFootage + Number.EPSILON) * 100) / 100)
  ) {
    throw invalidResponse();
  }
  return {
    evidenceId: readContractId(comparable.evidenceId),
    propertyId: readPattern(comparable.propertyId, publicPropertyIdPattern, 37),
    formattedAddress: readText(comparable.formattedAddress, 300),
    salePrice,
    saleDate: readDate(comparable.saleDate),
    distanceMiles: readNumber(comparable.distanceMiles, 0, 100),
    propertyType: readPropertyType(comparable.propertyType),
    bedrooms: readNullableIncrement(comparable.bedrooms, 0.25, 0, 100),
    bathrooms: readNullableIncrement(comparable.bathrooms, 0.25, 0, 100),
    squareFootage,
    lotSize: readNullableInteger(comparable.lotSize, 1, 100_000_000),
    yearBuilt: readNullableInteger(comparable.yearBuilt, 1600, 2200),
    pricePerSquareFoot,
    similarityScore: readNumber(comparable.similarityScore, 0, 1),
    latitude,
    longitude,
  };
}

function parseContext(value: unknown): PriceEstimationResult["context"] {
  const context = strictRecord(value, ["avm", "market", "listingSignals"]);
  return {
    avm: context.avm === null ? null : parseAvm(context.avm),
    market: context.market === null ? null : parseMarket(context.market),
    listingSignals:
      context.listingSignals === null
        ? null
        : parseListingSignals(context.listingSignals),
  };
}

function parseAvm(value: unknown): NonNullable<PriceEstimationResult["context"]["avm"]> {
  const avm = strictRecord(value, ["estimate", "rangeLow", "rangeHigh", "label", "retrievedAt"]);
  const result = {
    estimate: readMoney(avm.estimate),
    rangeLow: readMoney(avm.rangeLow),
    rangeHigh: readMoney(avm.rangeHigh),
    label: readLiteral(avm.label, "RentCast value estimate"),
    retrievedAt: readTimestamp(avm.retrievedAt),
  };
  if (result.rangeLow > result.estimate || result.estimate > result.rangeHigh) {
    throw invalidResponse();
  }
  return result;
}

function parseMarket(
  value: unknown,
): NonNullable<PriceEstimationResult["context"]["market"]> {
  const market = strictRecord(value, [
    "zipCode",
    "medianListPrice",
    "medianPricePerSquareFoot",
    "medianDaysOnMarket",
    "totalListings",
    "newListings",
    "lastUpdatedDate",
  ]);
  const result = {
    zipCode: readPattern(market.zipCode, /^\d{5}$/, 5),
    medianListPrice: readNullableMoney(market.medianListPrice),
    medianPricePerSquareFoot: readNullableNumber(market.medianPricePerSquareFoot, 0.01, 1_000_000),
    medianDaysOnMarket: readNullableNumber(market.medianDaysOnMarket, 0, 3_650),
    totalListings: readNullableInteger(market.totalListings, 0, 10_000_000),
    newListings: readNullableInteger(market.newListings, 0, 10_000_000),
    lastUpdatedDate: readDate(market.lastUpdatedDate),
  };
  if (
    (result.newListings !== null &&
      result.totalListings !== null &&
      result.newListings > result.totalListings) ||
    [
      result.medianListPrice,
      result.medianPricePerSquareFoot,
      result.medianDaysOnMarket,
      result.totalListings,
      result.newListings,
    ].every((statistic) => statistic === null)
  ) {
    throw invalidResponse();
  }
  return result;
}

function parseListingSignals(
  value: unknown,
): NonNullable<PriceEstimationResult["context"]["listingSignals"]> {
  const signals = strictRecord(value, [
    "currentListPrice",
    "daysOnMarket",
    "priceReductionCount",
    "totalReductionPercent",
    "flexibilitySignal",
    "isInference",
  ]);
  return {
    currentListPrice: readNullableMoney(signals.currentListPrice),
    daysOnMarket: readNullableInteger(signals.daysOnMarket, 0, 3_650),
    priceReductionCount: readInteger(signals.priceReductionCount, 0, 100),
    totalReductionPercent: readNumber(signals.totalReductionPercent, 0, 100),
    flexibilitySignal: readEnum(signals.flexibilitySignal, ["unknown", "low", "medium", "high"] as const),
    isInference: readLiteral(signals.isInference, true),
  };
}

function parseStrategy(value: unknown): PriceEstimationResult["strategy"] {
  const strategy = strictRecord(value, [
    "summary",
    "steps",
    "source",
    "enhancementUnavailable",
  ]);
  return {
    summary: readText(strategy.summary, 500),
    steps: readArray(strategy.steps, 3, 3).map((value) => {
      const step = strictRecord(value, ["scenarioKind", "guidance"]);
      return {
        scenarioKind: readEnum(step.scenarioKind, [
          "conservative",
          "recommended",
          "competitive",
          "quick-sale",
          "balanced",
          "stretch",
        ] as const),
        guidance: readText(step.guidance, 500),
      };
    }),
    source: readEnum(strategy.source, ["openai", "deterministic-fallback"] as const),
    enhancementUnavailable: readBoolean(strategy.enhancementUnavailable),
  };
}

function parseLimitation(value: unknown): PriceEstimationResult["limitations"][number] {
  const limitation = strictRecord(value, ["code", "message"]);
  return {
    code: readContractId(limitation.code),
    message: readText(limitation.message, 500),
  };
}

function strictRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidResponse();
  }
  return record;
}

function readArray(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw invalidResponse();
  }
  return value;
}

function readText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/\S/u.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidResponse();
  }
  return value;
}

function readPattern(value: unknown, pattern: RegExp, maximum: number): string {
  const text = readText(value, maximum);
  if (!pattern.test(text)) throw invalidResponse();
  return text;
}

function readContractId(value: unknown): string {
  return readPattern(value, contractIdPattern, 80);
}

function readPropertyType(value: unknown): ListingPropertyType {
  if (typeof value !== "string" || !propertyTypeSet.has(value)) throw invalidResponse();
  return value as ListingPropertyType;
}

function readNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidResponse();
  }
  return value;
}

function readInteger(value: unknown, minimum: number, maximum: number): number {
  const number = readNumber(value, minimum, maximum);
  if (!Number.isInteger(number)) throw invalidResponse();
  return number;
}

function readNullableNumber(value: unknown, minimum: number, maximum: number): number | null {
  return value === null ? null : readNumber(value, minimum, maximum);
}

function readNullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  return value === null ? null : readInteger(value, minimum, maximum);
}

function readNullableIncrement(
  value: unknown,
  increment: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  const number = readNumber(value, minimum, maximum);
  if (!Number.isInteger(number / increment)) throw invalidResponse();
  return number;
}

function readMoney(value: unknown): number {
  return readInteger(value, 1, maximumMoney);
}

function readRoundedMoney(value: unknown): number {
  const money = readMoney(value);
  if (money % 1_000 !== 0) throw invalidResponse();
  return money;
}

function readNullableMoney(value: unknown): number | null {
  return value === null ? null : readMoney(value);
}

function readDate(value: unknown): string {
  const date = readPattern(value, /^\d{4}-\d{2}-\d{2}$/, 10);
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw invalidResponse();
  }
  return date;
}

function readTimestamp(value: unknown): string {
  const timestamp = readText(value, 64);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw invalidResponse();
  }
  return timestamp;
}

function readEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw invalidResponse();
  return value as T[number];
}

function readLiteral<const T extends string | boolean>(value: unknown, expected: T): T {
  if (value !== expected) throw invalidResponse();
  return expected;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidResponse();
  return value;
}

function invalidResponse(): PriceEstimationRequestError {
  return new PriceEstimationRequestError("unexpected");
}
