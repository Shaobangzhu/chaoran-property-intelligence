import { createHash } from "node:crypto";

import {
  normalizePriceDecisionAddress,
  normalizePriceDecisionMode,
  type PriceDecisionAddressInput,
  type PriceDecisionMode,
} from "@chaoran-property-intelligence/domain";

import type { PriceEstimationExecution } from "./priceEstimationWorkflow.js";

const requestKeys = new Set([
  "streetAddress",
  "city",
  "zipCode",
  "mode",
]);

export interface PriceEstimationRequest {
  readonly address: PriceDecisionAddressInput;
  readonly mode: PriceDecisionMode;
}

export class InvalidPriceEstimationRequestError extends Error {
  constructor() {
    super("Price Estimation request was invalid");
    this.name = "InvalidPriceEstimationRequestError";
  }
}

export function parsePriceEstimationRequest(
  value: unknown,
): PriceEstimationRequest {
  if (!isExactRecord(value, requestKeys)) {
    throw new InvalidPriceEstimationRequestError();
  }
  try {
    const address = normalizePriceDecisionAddress({
      streetAddress: value.streetAddress,
      city: value.city,
      zipCode: value.zipCode,
    });
    return Object.freeze({
      address: Object.freeze({
        streetAddress: address.streetAddress,
        city: address.city,
        zipCode: address.zipCode,
      }),
      mode: normalizePriceDecisionMode(value.mode),
    });
  } catch {
    throw new InvalidPriceEstimationRequestError();
  }
}

export function toPriceEstimationResponse(
  execution: PriceEstimationExecution,
  analysisId: string,
) {
  const { evidence, result } = execution.prepared;
  const salesById = new Map(
    evidence.recordedSales.map((sale) => [sale.evidenceId, sale]),
  );
  const listingSignals = summarizeListingSignals(execution);

  return {
    analysisId,
    methodologyVersion: result.methodologyVersion,
    mode: result.mode,
    subject: {
      propertyId: toPublicPropertyId(evidence.subject.propertyId),
      formattedAddress: evidence.subject.formattedAddress,
      propertyType: evidence.subject.propertyType,
      bedrooms: evidence.subject.bedrooms,
      bathrooms: evidence.subject.bathrooms,
      squareFootage: evidence.subject.squareFootage,
      lotSize: evidence.subject.lotSize,
      yearBuilt: evidence.subject.yearBuilt,
      latitude: evidence.subject.latitude,
      longitude: evidence.subject.longitude,
    },
    recommendation: {
      recommendedPrice: result.recommendedPrice,
      rangeLow: result.rangeLow,
      rangeHigh: result.rangeHigh,
      marketValueAnchor: result.marketValueAnchor,
      currency: result.currency,
      confidence: result.confidence,
      dataAsOf: result.evaluatedAt,
    },
    scenarios: result.scenarios.map((scenario) => ({ ...scenario })),
    reasons: execution.explanation.reasons.map((reason) => ({
      ...reason,
      evidenceIds: [...reason.evidenceIds],
    })),
    comparables: result.scoredComparables.map((scored) => {
      const sale = salesById.get(scored.evidenceId);
      if (sale === undefined) {
        throw new Error("Price Estimation comparable evidence was missing");
      }
      return {
        evidenceId: sale.evidenceId,
        propertyId: toPublicPropertyId(sale.propertyId),
        formattedAddress: sale.formattedAddress,
        salePrice: sale.salePrice,
        saleDate: sale.saleDate,
        distanceMiles: sale.distanceMiles,
        propertyType: sale.propertyType,
        bedrooms: sale.bedrooms,
        bathrooms: sale.bathrooms,
        squareFootage: sale.squareFootage,
        lotSize: sale.lotSize,
        yearBuilt: sale.yearBuilt,
        pricePerSquareFoot:
          sale.squareFootage === null
            ? null
            : roundDecimal(sale.salePrice / sale.squareFootage, 2),
        similarityScore: scored.similarityScore,
        latitude: sale.latitude,
        longitude: sale.longitude,
      };
    }),
    context: {
      avm:
        evidence.externalValueEstimate === null
          ? null
          : {
              estimate: evidence.externalValueEstimate.estimate,
              rangeLow: evidence.externalValueEstimate.rangeLow,
              rangeHigh: evidence.externalValueEstimate.rangeHigh,
              label: "RentCast value estimate",
              retrievedAt: evidence.externalValueEstimate.retrievedAt,
            },
      market:
        evidence.marketContext === null
          ? null
          : {
              zipCode: evidence.marketContext.zipCode,
              medianListPrice: evidence.marketContext.medianListPrice,
              medianPricePerSquareFoot:
                evidence.marketContext.medianPricePerSquareFoot,
              medianDaysOnMarket: evidence.marketContext.medianDaysOnMarket,
              totalListings: evidence.marketContext.totalListings,
              newListings: evidence.marketContext.newListings,
              lastUpdatedDate: evidence.marketContext.lastUpdatedDate,
            },
      listingSignals,
    },
    strategy: {
      summary: execution.explanation.strategy.summary,
      steps: execution.explanation.strategy.steps.map((step) => ({ ...step })),
      source: execution.explanation.source,
      enhancementUnavailable: execution.explanation.enhancementUnavailable,
    },
    limitations: execution.explanation.limitations.map((limitation) => ({
      ...limitation,
    })),
  };
}

function summarizeListingSignals(execution: PriceEstimationExecution) {
  const listing = execution.prepared.evidence.targetListing;
  if (listing === null) return null;
  let previousPrice: number | null = null;
  let priceReductionCount = 0;
  for (const event of listing.events) {
    if (event.price === null) continue;
    if (
      event.kind === "price-change" &&
      previousPrice !== null &&
      event.price < previousPrice
    ) {
      priceReductionCount += 1;
    }
    previousPrice = event.price;
  }
  const firstKnownPrice = listing.events.find(
    (event) =>
      (event.kind === "listed" || event.kind === "relisted") &&
      event.price !== null,
  )?.price;
  const totalReductionPercent =
    priceReductionCount > 0 &&
    firstKnownPrice !== undefined &&
    firstKnownPrice !== null &&
    listing.currentListPrice !== null &&
    listing.currentListPrice < firstKnownPrice
      ? roundDecimal(
          ((firstKnownPrice - listing.currentListPrice) / firstKnownPrice) *
            100,
          1,
        )
      : 0;

  return {
    currentListPrice: listing.currentListPrice,
    daysOnMarket: listing.daysOnMarket,
    priceReductionCount,
    totalReductionPercent,
    flexibilitySignal: execution.prepared.result.flexibilitySignal,
    isInference: true,
  };
}

function roundDecimal(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function toPublicPropertyId(providerPropertyId: string): string {
  const digest = createHash("sha256")
    .update(providerPropertyId)
    .digest("hex")
    .slice(0, 24);
  return `cpi-property-${digest}`;
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
