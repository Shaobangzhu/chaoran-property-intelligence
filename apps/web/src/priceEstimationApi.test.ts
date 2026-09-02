import { describe, expect, it, vi } from "vitest";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  estimatePropertyPrice,
  parsePriceEstimationResponse,
  PriceEstimationRequestError,
  PriceEstimationValidationError,
} from "./priceEstimationApi.js";

describe("priceEstimationApi", () => {
  it("normalizes and submits the exact same-origin request", async () => {
    const fetchImplementation = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(createResponse()),
    );

    const result = await estimatePropertyPrice(
      {
        streetAddress: " 100   Test Ave ",
        city: " Irvine ",
        zipCode: "92618",
        mode: "offer",
      },
      { fetchImplementation },
    );

    expect(result.recommendation.recommendedPrice).toBe(1_000_000);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [path, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(path).toBe("/api/price-estimations");
    expect(init).toMatchObject({
      credentials: "same-origin",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      streetAddress: "100 Test Ave",
      city: "Irvine",
      zipCode: "92618",
      mode: "offer",
    });
  });

  it("rejects invalid input before starting a request", async () => {
    const fetchImplementation = vi.fn<typeof globalThis.fetch>();

    await expect(
      estimatePropertyPrice(
        {
          streetAddress: "Test Avenue",
          city: "Irvine",
          zipCode: "92618",
          mode: "offer",
        },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({
      field: "streetAddress",
      name: "PriceEstimationValidationError",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("propagates abort signals", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(createResponse()),
    );

    await estimatePropertyPrice(createInput(), {
      fetchImplementation,
      signal: controller.signal,
    });

    expect(fetchImplementation.mock.calls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
  });

  it("rejects a success response for a different requested mode", async () => {
    const value = createResponse();
    value.mode = "listing";
    value.scenarios = [
      { kind: "quick-sale", price: 980_000, label: "Quick sale", tradeoff: "Lower position." },
      { kind: "balanced", price: 1_000_000, label: "Balanced", tradeoff: "Central position." },
      { kind: "stretch", price: 1_020_000, label: "Stretch", tradeoff: "Higher position." },
    ];
    value.strategy.steps = [
      { scenarioKind: "quick-sale", guidance: "Use the lower position." },
      { scenarioKind: "balanced", guidance: "Use the central position." },
      { scenarioKind: "stretch", guidance: "Use the higher position." },
    ];

    await expect(
      estimatePropertyPrice(createInput(), {
        fetchImplementation: async () => Response.json(value),
      }),
    ).rejects.toMatchObject({ code: "unexpected" });
  });

  it("maps session expiry without reading private error details", async () => {
    await expect(
      estimatePropertyPrice(createInput(), {
        fetchImplementation: async () =>
          Response.json({ error: { message: "private" } }, { status: 401 }),
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
  });

  it.each([
    [400, PriceEstimationValidationError, undefined],
    [404, PriceEstimationRequestError, "property-not-found"],
    [409, PriceEstimationRequestError, "in-progress"],
    [422, PriceEstimationRequestError, "insufficient-evidence"],
    [429, PriceEstimationRequestError, "rate-limited"],
    [502, PriceEstimationRequestError, "evidence-unavailable"],
    [503, PriceEstimationRequestError, "service-unavailable"],
    [504, PriceEstimationRequestError, "timed-out"],
    [500, PriceEstimationRequestError, "unexpected"],
  ])("maps status %i to a bounded client failure", async (status, ErrorType, code) => {
    const result = estimatePropertyPrice(createInput(), {
      fetchImplementation: async () =>
        Response.json({ error: { message: "provider secret" } }, { status }),
    });

    await expect(result).rejects.toBeInstanceOf(ErrorType);
    if (code !== undefined) await expect(result).rejects.toMatchObject({ code });
  });

  it("accepts explicit nullable context and deterministic fallback", () => {
    const value = createResponse();
    Object.assign(value, {
      context: { avm: null, market: null, listingSignals: null },
    });
    value.strategy = {
      ...value.strategy,
      source: "deterministic-fallback",
      enhancementUnavailable: true,
    };

    expect(parsePriceEstimationResponse(value)).toMatchObject({
      context: { avm: null, market: null, listingSignals: null },
      strategy: {
        source: "deterministic-fallback",
        enhancementUnavailable: true,
      },
    });
  });

  it.each([
    (value: ReturnType<typeof createResponse>) => {
      Object.assign(value, { rawProviderPayload: {} });
    },
    (value: ReturnType<typeof createResponse>) => {
      value.subject.propertyId = "rentcast-property-id";
    },
    (value: ReturnType<typeof createResponse>) => {
      value.recommendation.rangeLow = 1_100_000;
    },
    (value: ReturnType<typeof createResponse>) => {
      value.recommendation.recommendedPrice = 1_000_001;
    },
    (value: ReturnType<typeof createResponse>) => {
      value.scenarios.reverse();
    },
    (value: ReturnType<typeof createResponse>) => {
      value.strategy.steps[0]!.scenarioKind = "stretch";
    },
    (value: ReturnType<typeof createResponse>) => {
      value.strategy.source = "deterministic-fallback";
    },
    (value: ReturnType<typeof createResponse>) => {
      Object.assign(value.comparables[0]!, { unexpected: "field" });
    },
  ])("fails closed on a malformed or expanded success response", (mutate) => {
    const value = createResponse();
    mutate(value);
    expect(() => parsePriceEstimationResponse(value)).toThrow(
      PriceEstimationRequestError,
    );
  });
});

function createInput() {
  return {
    streetAddress: "100 Test Ave",
    city: "Irvine",
    zipCode: "92618",
    mode: "offer" as const,
  };
}

function createResponse() {
  const comparables = [1, 2, 3].map((number) => ({
    evidenceId: `sale-comp-${number}`,
    propertyId: `cpi-property-${String(number).repeat(24)}`,
    formattedAddress: `${200 + number} Fixture Rd, Irvine, CA 92618`,
    salePrice: 990_000 + number * 5_000,
    saleDate: `2026-0${number + 4}-15`,
    distanceMiles: number * 0.2,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2_000,
    lotSize: 5_000,
    yearBuilt: 2000,
    pricePerSquareFoot: (990_000 + number * 5_000) / 2_000,
    similarityScore: 0.9,
    latitude: 33.65,
    longitude: -117.74,
  }));
  return {
    analysisId: "request-id",
    methodologyVersion: "cpi-price-decision-v1",
    mode: "offer",
    subject: {
      propertyId: `cpi-property-${"a".repeat(24)}`,
      formattedAddress: "100 Test Ave, Irvine, CA 92618",
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2_000,
      lotSize: 5_000,
      yearBuilt: 2000,
      latitude: 33.65,
      longitude: -117.74,
    },
    recommendation: {
      recommendedPrice: 1_000_000,
      rangeLow: 950_000,
      rangeHigh: 1_050_000,
      marketValueAnchor: 1_000_000,
      currency: "USD",
      confidence: "medium",
      dataAsOf: "2026-09-01T18:00:00.000Z",
    },
    scenarios: [
      {
        kind: "conservative",
        price: 980_000,
        label: "Conservative",
        tradeoff: "Lower position with greater rejection risk.",
      },
      {
        kind: "recommended",
        price: 1_000_000,
        label: "Recommended",
        tradeoff: "Balances evidence and acceptance probability.",
      },
      {
        kind: "competitive",
        price: 1_020_000,
        label: "Competitive",
        tradeoff: "Higher position with less rejection risk.",
      },
    ],
    reasons: [
      {
        title: "Recorded sales",
        detail: "Recent recorded sales support the recommendation.",
        evidenceIds: comparables.map(({ evidenceId }) => evidenceId),
      },
    ],
    comparables,
    context: {
      avm: {
        estimate: 1_010_000,
        rangeLow: 960_000,
        rangeHigh: 1_060_000,
        label: "RentCast value estimate",
        retrievedAt: "2026-09-01T17:59:00.000Z",
      },
      market: {
        zipCode: "92618",
        medianListPrice: 1_020_000,
        medianPricePerSquareFoot: 505,
        medianDaysOnMarket: 30,
        totalListings: 100,
        newListings: 20,
        lastUpdatedDate: "2026-09-01",
      },
      listingSignals: {
        currentListPrice: 1_030_000,
        daysOnMarket: 45,
        priceReductionCount: 1,
        totalReductionPercent: 2.8,
        flexibilitySignal: "medium",
        isInference: true,
      },
    },
    strategy: {
      summary: "Use the evidence-backed central position.",
      steps: [
        { scenarioKind: "conservative", guidance: "Preserve more room." },
        { scenarioKind: "recommended", guidance: "Use the central position." },
        { scenarioKind: "competitive", guidance: "Improve competitiveness." },
      ],
      source: "openai",
      enhancementUnavailable: false,
    },
    limitations: [
      {
        code: "condition-unknown",
        message: "Interior condition and unreported renovations are not modeled.",
      },
    ],
  };
}
