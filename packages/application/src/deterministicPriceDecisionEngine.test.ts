import { describe, expect, it } from "vitest";

import {
  ContradictoryPriceDecisionEvidenceError,
  EstimatePropertyPrice,
  InsufficientPriceDecisionEvidenceError,
  PRICE_DECISION_METHODOLOGY_VERSION,
  type PriceDecisionEngineInput,
} from "./estimatePropertyPrice.js";
import { DeterministicPriceDecisionEngine } from "./deterministicPriceDecisionEngine.js";
import { FakePriceDecisionEvidenceProvider } from "./fakePriceDecisionEvidence.js";
import {
  normalizePriceDecisionEvidence,
  type PriceDecisionEvidence,
  type PriceDecisionTargetListing,
  type RecordedSaleComparable,
} from "./priceDecisionEvidence.js";

const evaluatedAt = "2026-09-01T18:00:00.000Z";

describe("DeterministicPriceDecisionEngine", () => {
  it("produces the frozen normal-market offer golden result", () => {
    const result = estimate("offer", createEvidence());

    expect(result).toMatchObject({
      methodologyVersion: PRICE_DECISION_METHODOLOGY_VERSION,
      mode: "offer",
      subjectPropertyId: "subject-property",
      marketValueAnchor: 1_000_000,
      recommendedPrice: 1_000_000,
      rangeLow: 960_000,
      rangeHigh: 1_040_000,
      confidence: "high",
      flexibilitySignal: "low",
    });
    expect(result.scenarios.map(({ kind, price }) => ({ kind, price }))).toEqual([
      { kind: "conservative", price: 980_000 },
      { kind: "recommended", price: 1_000_000 },
      { kind: "competitive", price: 1_010_000 },
    ]);
    expect(result.scoredComparables).toEqual([
      { evidenceId: "sale-comp-5", similarityScore: 0.9603 },
      { evidenceId: "sale-comp-4", similarityScore: 0.9479 },
      { evidenceId: "sale-comp-3", similarityScore: 0.9392 },
      { evidenceId: "sale-comp-2", similarityScore: 0.9269 },
      { evidenceId: "sale-comp-1", similarityScore: 0.9181 },
    ]);
    expect(result.factors[0]).toMatchObject({
      factorId: "recorded-sales-anchor",
      rank: 1,
      impact: "high",
    });
    expect(result.factors[0]?.evidenceIds).toHaveLength(5);
    expect(result.limitations.map(({ code }) => code)).toEqual([
      "condition-unknown",
      "seller-flexibility-inference",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("uses the same anchor for the frozen listing-mode strategy", () => {
    const result = estimate("listing", createEvidence());

    expect(result.marketValueAnchor).toBe(1_000_000);
    expect(result.recommendedPrice).toBe(1_000_000);
    expect(result.flexibilitySignal).toBe("low");
    expect(result.scenarios.map(({ kind, price }) => ({ kind, price }))).toEqual([
      { kind: "quick-sale", price: 980_000 },
      { kind: "balanced", price: 1_000_000 },
      { kind: "stretch", price: 1_025_000 },
    ]);
    expect(result.scenarios[1]?.tradeoff).toContain("15-day review checkpoint");
  });

  it("keeps a fresh hot-market listing at low inferred flexibility", () => {
    const result = estimate(
      "offer",
      createEvidence({
        targetListing: createListing({ daysOnMarket: 2 }),
        marketContext: {
          ...createEvidence().marketContext!,
          medianDaysOnMarket: 8,
        },
      }),
    );

    expect(result.flexibilitySignal).toBe("low");
    expect(result.recommendedPrice).toBe(1_000_000);
    expect(result.confidence).toBe("high");
  });

  it("uses unknown flexibility when listing evidence is absent", () => {
    const result = estimate(
      "offer",
      createEvidence({ targetListing: null }),
    );

    expect(result.flexibilitySignal).toBe("unknown");
    expect(result.recommendedPrice).toBe(1_000_000);
    expect(result.limitations.map(({ code }) => code)).toContain(
      "listing-context-unavailable",
    );
  });

  it("caps stale-listing and verified reduction leverage at 2.5 percent", () => {
    const listing = createListing({
      currentListPrice: 1_020_000,
      daysOnMarket: 60,
      events: [
        listingEvent("listed", "2026-06-01", 1_080_000, 1),
        listingEvent("price-change", "2026-07-01", 1_050_000, 2),
        listingEvent("price-change", "2026-08-01", 1_020_000, 3),
      ],
    });

    const result = estimate("offer", createEvidence({ targetListing: listing }));

    expect(result.flexibilitySignal).toBe("high");
    expect(result.recommendedPrice).toBe(975_000);
    expect(result.scenarios.map(({ price }) => price)).toEqual([
      960_000,
      975_000,
      1_010_000,
    ]);
    expect(result.factors).toContainEqual(
      expect.objectContaining({
        factorId: "observable-listing-flexibility",
        direction: "supports-lower",
        impact: "high",
      }),
    );
  });

  it("does not mislabel a price increase as negotiation leverage", () => {
    const listing = createListing({
      currentListPrice: 1_050_000,
      events: [
        listingEvent("listed", "2026-08-12", 1_030_000, 1),
        listingEvent("price-change", "2026-08-20", 1_050_000, 2),
      ],
    });

    const result = estimate("offer", createEvidence({ targetListing: listing }));

    expect(result.flexibilitySignal).toBe("low");
    expect(result.recommendedPrice).toBe(1_000_000);
    expect(
      result.factors.find(
        ({ factorId }) => factorId === "observable-listing-flexibility",
      )?.detail,
    ).toContain("0 verified price reductions");
  });

  it("does not infer a price reduction from separate listing episodes", () => {
    const listing = createListing({
      currentListPrice: 1_020_000,
      events: [
        listingEvent("listed", "2026-06-01", 1_080_000, 1),
        listingEvent("removed", "2026-07-01", 1_080_000, 2),
        listingEvent("relisted", "2026-08-12", 1_020_000, 3),
      ],
    });

    const result = estimate("offer", createEvidence({ targetListing: listing }));

    expect(result.flexibilitySignal).toBe("medium");
    expect(result.recommendedPrice).toBe(990_000);
    expect(
      result.factors.find(
        ({ factorId }) => factorId === "observable-listing-flexibility",
      )?.detail,
    ).toContain("0 verified price reductions");
  });

  it("expands the pool explicitly and lowers confidence", () => {
    const expandedSales = createSales(4).map((sale, index) => ({
      ...sale,
      saleDate: "2026-02-01",
      distanceMiles: 1.5 + index * 0.2,
    }));

    const result = estimate(
      "offer",
      createEvidence({ recordedSales: expandedSales }),
    );

    expect(result.scoredComparables).toHaveLength(4);
    expect(result.confidence).toBe("low");
    expect(result.rangeLow).toBeLessThan(960_000);
    expect(result.rangeHigh).toBeGreaterThan(1_040_000);
    expect(result.limitations.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["expanded-comparable-pool", "sparse-comparables"]),
    );
  });

  it("fails closed with fewer than three eligible actual-sale comparables", () => {
    const sales = [
      ...createSales(2),
      { ...createSale(3), saleDate: "2025-08-01" },
      { ...createSale(4), distanceMiles: 5.1 },
      { ...createSale(5), propertyType: "Land" as const },
    ];

    expect(() => estimate("offer", createEvidence({ recordedSales: sales }))).toThrow(
      InsufficientPriceDecisionEvidenceError,
    );
  });

  it("fails closed when subject-equivalent square-footage pricing is unavailable", () => {
    const evidence = createEvidence({
      subject: { ...createEvidence().subject, squareFootage: null },
    });

    expect(() => estimate("offer", evidence)).toThrow(
      InsufficientPriceDecisionEvidenceError,
    );
  });

  it("excludes a MAD extreme without moving the anchor toward the desired result", () => {
    const sales = [
      ...createSales(5),
      { ...createSale(6), salePrice: 2_000_000, squareFootage: 2_000 },
    ];

    const result = estimate("offer", createEvidence({ recordedSales: sales }));

    expect(result.marketValueAnchor).toBe(1_000_000);
    expect(result.scoredComparables).toHaveLength(5);
    expect(result.scoredComparables.map(({ evidenceId }) => evidenceId)).not.toContain(
      "sale-comp-6",
    );
    expect(result.limitations.map(({ code }) => code)).toContain(
      "recorded-sale-outlier",
    );
  });

  it(
    "widens for material AVM disagreement and refuses severe contradiction",
    () => {
      const material = estimate(
        "offer",
        createEvidence({
          externalValueEstimate: createAvm({
            estimate: 1_300_000,
            rangeLow: 1_250_000,
            rangeHigh: 1_350_000,
          }),
        }),
      );

      expect(material.confidence).toBe("medium");
      expect(material.rangeLow).toBe(850_000);
      expect(material.rangeHigh).toBe(1_150_000);
      expect(material.limitations.map(({ code }) => code)).toContain(
        "avm-disagreement",
      );

      expect(() =>
        estimate(
          "offer",
          createEvidence({
            externalValueEstimate: createAvm({
              estimate: 1_400_000,
              rangeLow: 1_350_000,
              rangeHigh: 1_450_000,
            }),
          }),
        ),
      ).toThrow(ContradictoryPriceDecisionEvidenceError);
    },
  );

  it("supports condominium evidence without fabricating lot-size similarity", () => {
    const subject = {
      ...createEvidence().subject,
      propertyType: "Condo" as const,
      lotSize: null,
    };
    const sales = createSales(5).map((sale) => ({
      ...sale,
      propertyType: "Condo" as const,
      lotSize: null,
    }));

    const result = estimate(
      "listing",
      createEvidence({ subject, recordedSales: sales }),
    );

    expect(result.marketValueAnchor).toBe(1_000_000);
    expect(result.scoredComparables).toHaveLength(5);
    expect(result.limitations.map(({ code }) => code)).not.toContain(
      "missing-structural-data",
    );
  });

  it("is stable for identical input and does not mutate frozen evidence", () => {
    const evidence = createEvidence();
    const before = structuredClone(evidence);

    const first = estimate("offer", evidence);
    const second = estimate("offer", evidence);

    expect(second).toEqual(first);
    expect(evidence).toEqual(before);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("composes through EstimatePropertyPrice without a fake engine", async () => {
    const useCase = new EstimatePropertyPrice({
      evidenceProvider: new FakePriceDecisionEvidenceProvider({
        type: "success",
        evidence: createEvidence(),
      }),
      engine: new DeterministicPriceDecisionEngine(),
      now: () => new Date(evaluatedAt),
    });

    const result = await useCase.execute({
      address: {
        streetAddress: "100 Test Ave",
        city: "Irvine",
        zipCode: "92618",
      },
      mode: "listing",
    });

    expect(result).toMatchObject({
      mode: "listing",
      marketValueAnchor: 1_000_000,
      recommendedPrice: 1_000_000,
      confidence: "high",
    });
  });
});

function estimate(
  mode: "offer" | "listing",
  evidence: PriceDecisionEvidence,
) {
  const engine = new DeterministicPriceDecisionEngine();
  const input: PriceDecisionEngineInput = {
    address: {
      streetAddress: "100 Test Ave",
      city: "Irvine",
      state: "CA",
      zipCode: "92618",
    },
    mode,
    evidence,
    evaluatedAt,
  };
  return engine.estimate(input);
}

function createEvidence(options: {
  subject?: PriceDecisionEvidence["subject"];
  recordedSales?: readonly RecordedSaleComparable[];
  targetListing?: PriceDecisionTargetListing | null;
  marketContext?: PriceDecisionEvidence["marketContext"];
  externalValueEstimate?: PriceDecisionEvidence["externalValueEstimate"];
} = {}): PriceDecisionEvidence {
  return normalizePriceDecisionEvidence({
    acquiredAt: "2026-09-01T17:59:00.000Z",
    subject:
      options.subject ??
      {
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
    recordedSales: options.recordedSales ?? createSales(5),
    targetListing:
      options.targetListing === undefined
        ? createListing()
        : options.targetListing,
    marketContext:
      options.marketContext === undefined
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
        : options.marketContext,
    externalValueEstimate:
      options.externalValueEstimate === undefined
        ? createAvm()
        : options.externalValueEstimate,
  });
}

function createSales(count: number): RecordedSaleComparable[] {
  return Array.from({ length: count }, (_, index) => createSale(index + 1));
}

function createSale(index: number): RecordedSaleComparable {
  const squareFootages = [1_960, 2_040, 2_020, 1_980, 2_000, 2_000];
  const salePrices = [980_000, 1_020_000, 1_010_000, 990_000, 1_000_000, 1_000_000];
  return {
    evidenceId: `sale-comp-${index}`,
    source: "recorded-sale",
    propertyId: `comp-property-${index}`,
    formattedAddress: `${200 + index} Fixture Rd, Irvine, CA 92618`,
    salePrice: salePrices[index - 1] ?? 1_000_000,
    saleDate: `2026-0${Math.min(index + 2, 8)}-15`,
    distanceMiles: index * 0.1,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: squareFootages[index - 1] ?? 2_000,
    lotSize: 5_000,
    yearBuilt: 2000,
    latitude: 33.65 + index * 0.001,
    longitude: -117.74 - index * 0.001,
  };
}

function createListing(
  overrides: Partial<PriceDecisionTargetListing> = {},
): PriceDecisionTargetListing {
  return {
    evidenceId: "target-listing",
    status: "active",
    currentListPrice: 1_030_000,
    listedDate: "2026-08-12",
    lastSeenDate: "2026-09-01",
    daysOnMarket: 20,
    events: [listingEvent("listed", "2026-08-12", 1_030_000, 1)],
    ...overrides,
  };
}

function listingEvent(
  kind: "listed" | "price-change" | "removed" | "relisted",
  occurredOn: string,
  price: number | null,
  index: number,
) {
  return {
    evidenceId: `listing-event-${index}`,
    kind,
    occurredOn,
    price,
  } as const;
}

function createAvm(
  overrides: Partial<NonNullable<PriceDecisionEvidence["externalValueEstimate"]>> = {},
) {
  return {
    evidenceId: "external-avm",
    providerName: "RentCast",
    estimate: 1_000_000,
    rangeLow: 950_000,
    rangeHigh: 1_050_000,
    retrievedAt: "2026-09-01T17:58:00.000Z",
    ...overrides,
  };
}
