import {
  DeterministicPriceDecisionEngine,
  DeterministicPriceDecisionExplainer,
  GeneratePriceDecisionExplanation,
  normalizePriceDecisionEvidence,
  type PreparedPriceDecision,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  InvalidPriceEstimationRequestError,
  parsePriceEstimationRequest,
  toPriceEstimationResponse,
} from "./priceEstimationDto.js";
import type { PriceEstimationExecution } from "./priceEstimationWorkflow.js";

const evaluatedAt = "2026-09-01T18:00:00.000Z";

describe("Price Estimation DTO", () => {
  it("normalizes the exact four-field California request", () => {
    const parsed = parsePriceEstimationRequest({
      streetAddress: "  100   Test Ave  ",
      city: " Irvine ",
      zipCode: "92618",
      mode: "offer",
    });

    expect(parsed).toEqual({
      address: {
        streetAddress: "100 Test Ave",
        city: "Irvine",
        zipCode: "92618",
      },
      mode: "offer",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.address)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
      state: "CA",
    },
    {
      streetAddress: "Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
    },
    {
      streetAddress: "100 Test Ave, Irvine",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
    },
    {
      streetAddress: "100 Test Ave",
      city: "Irvine, CA",
      zipCode: "92618",
      mode: "offer",
    },
    {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "9261A",
      mode: "offer",
    },
    {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "estimate",
    },
  ])("rejects invalid or expanded input %#", (input) => {
    expect(() => parsePriceEstimationRequest(input)).toThrow(
      InvalidPriceEstimationRequestError,
    );
  });

  it("maps deterministic evidence and explanation to the provider-neutral response", async () => {
    const execution = await createExecution();
    const response = toPriceEstimationResponse(
      execution,
      "0198c7d2-7668-7775-b0fc-b789690a60d9",
    );

    expect(response).toMatchObject({
      analysisId: "0198c7d2-7668-7775-b0fc-b789690a60d9",
      methodologyVersion: "cpi-price-decision-v1",
      mode: "offer",
      subject: {
        propertyId: expect.stringMatching(/^cpi-property-[a-f0-9]{24}$/),
        formattedAddress: "100 Test Ave, Irvine, CA 92618",
        squareFootage: 2_000,
      },
      recommendation: {
        currency: "USD",
        dataAsOf: evaluatedAt,
        marketValueAnchor: 1_000_000,
      },
      context: {
        avm: {
          estimate: 1_000_000,
          label: "RentCast value estimate",
        },
        market: { zipCode: "92618" },
        listingSignals: {
          currentListPrice: 980_000,
          priceReductionCount: 1,
          totalReductionPercent: 4.9,
          isInference: true,
        },
      },
      strategy: {
        source: "openai",
        enhancementUnavailable: false,
      },
    });
    expect(response.comparables).toHaveLength(5);
    expect(response.comparables[0]).toMatchObject({
      evidenceId: execution.prepared.result.scoredComparables[0]?.evidenceId,
      salePrice: 1_000_000,
      pricePerSquareFoot: 500,
      similarityScore:
        execution.prepared.result.scoredComparables[0]?.similarityScore,
    });
    expect(response.reasons[0]?.evidenceIds).toEqual(
      execution.prepared.result.factors[0]?.evidenceIds,
    );
    expect(response.limitations.map(({ code }) => code)).toEqual(
      execution.explanation.limitations.map(({ code }) => code),
    );
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("providerRequestCounts");
    expect(serialized).not.toContain("subject-property");
    expect(serialized).not.toContain("comp-property");
    expect(serialized).not.toContain("providerName");
    expect(serialized).not.toContain("prompt");
  });

  it("uses explicit nulls for unavailable optional evidence", async () => {
    const execution = await createExecution({ optionalEvidence: false });
    const response = toPriceEstimationResponse(execution, "analysis-id");

    expect(response.context).toEqual({
      avm: null,
      market: null,
      listingSignals: null,
    });
  });
});

async function createExecution(
  options: { readonly optionalEvidence?: boolean } = {},
): Promise<PriceEstimationExecution> {
  const evidence = normalizePriceDecisionEvidence(
    createEvidence(options.optionalEvidence ?? true),
  );
  const address = {
    streetAddress: "100 Test Ave",
    city: "Irvine",
    state: "CA" as const,
    zipCode: "92618",
  };
  const result = new DeterministicPriceDecisionEngine().estimate({
    address,
    mode: "offer",
    evidence,
    evaluatedAt,
  });
  const prepared: PreparedPriceDecision = { address, evidence, result };
  const template = new DeterministicPriceDecisionExplainer();
  const explanation = await new GeneratePriceDecisionExplanation({
    primary: template,
  }).execute({ evidence, result });
  return {
    prepared,
    explanation,
    providerRequestCounts: { rentcast: 4, openai: 1 },
  };
}

function createEvidence(optionalEvidence: boolean) {
  return {
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
    targetListing: optionalEvidence
      ? {
          evidenceId: "target-listing",
          status: "active",
          currentListPrice: 980_000,
          listedDate: "2026-07-01",
          lastSeenDate: "2026-09-01",
          daysOnMarket: 62,
          events: [
            {
              evidenceId: "listing-event-1",
              kind: "listed",
              occurredOn: "2026-07-01",
              price: 1_030_000,
            },
            {
              evidenceId: "listing-event-2",
              kind: "price-change",
              occurredOn: "2026-08-15",
              price: 980_000,
            },
          ],
        }
      : null,
    marketContext: optionalEvidence
      ? {
          evidenceId: "zip-market",
          zipCode: "92618",
          lastUpdatedDate: "2026-09-01",
          medianListPrice: 1_020_000,
          medianPricePerSquareFoot: 505,
          medianDaysOnMarket: 30,
          totalListings: 100,
          newListings: 20,
        }
      : null,
    externalValueEstimate: optionalEvidence
      ? {
          evidenceId: "external-avm",
          providerName: "RentCast",
          estimate: 1_000_000,
          rangeLow: 950_000,
          rangeHigh: 1_050_000,
          retrievedAt: "2026-09-01T17:58:00.000Z",
        }
      : null,
  };
}
