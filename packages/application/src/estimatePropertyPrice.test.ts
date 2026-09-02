import { describe, expect, it } from "vitest";

import type { PriceDecisionAddressInput } from "@chaoran-property-intelligence/domain";

import {
  ContradictoryPriceDecisionEvidenceError,
  EstimatePropertyPrice,
  InsufficientPriceDecisionEvidenceError,
  InvalidPriceDecisionClockError,
  InvalidPriceDecisionEvidenceResultError,
  InvalidPriceDecisionInputError,
  InvalidPriceDecisionResultError,
  normalizePriceDecisionResult,
  PRICE_DECISION_METHODOLOGY_VERSION,
  type PriceDecisionResult,
} from "./estimatePropertyPrice.js";
import {
  FakePriceDecisionEngine,
  FakePriceDecisionEvidenceProvider,
} from "./fakePriceDecisionEvidence.js";
import {
  InvalidPriceDecisionEvidenceError,
  normalizePriceDecisionEvidence,
  PriceDecisionEvidenceUnavailableError,
  PriceDecisionSubjectNotFoundError,
  type PriceDecisionEvidence,
} from "./priceDecisionEvidence.js";

const evaluatedAt = "2026-09-01T18:00:00.000Z";
const inputAddress: PriceDecisionAddressInput = {
  streetAddress: "123 Main St",
  city: "Irvine",
  zipCode: "92612",
};

describe("price decision evidence contract", () => {
  it("strictly normalizes, deterministically orders, and deeply freezes evidence", () => {
    const evidence = normalizePriceDecisionEvidence(createEvidence());

    expect(evidence.recordedSales.map((sale) => sale.evidenceId)).toEqual([
      "sale-comp-1",
      "sale-comp-2",
      "sale-comp-3",
    ]);
    expect(
      evidence.targetListing?.events.map((event) => event.evidenceId),
    ).toEqual(["listing-event-1", "listing-event-2"]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.subject)).toBe(true);
    expect(Object.isFrozen(evidence.recordedSales)).toBe(true);
    expect(Object.isFrozen(evidence.recordedSales[0])).toBe(true);
    expect(Object.isFrozen(evidence.targetListing?.events)).toBe(true);
  });

  it.each([
    { extra: true },
    { acquiredAt: "not-a-timestamp" },
    { recordedSales: [{ ...createSale(1), salePrice: 1.5 }] },
    { recordedSales: [{ ...createSale(1), saleDate: "2026-02-30" }] },
    {
      externalValueEstimate: {
        ...createEvidence().externalValueEstimate,
        rangeLow: 1_500_000,
      },
    },
  ])("rejects malformed evidence: %o", (overrides) => {
    expect(() =>
      normalizePriceDecisionEvidence(createEvidence(overrides)),
    ).toThrow(InvalidPriceDecisionEvidenceError);
  });

  it("rejects duplicate evidence and property identities", () => {
    const duplicateEvidence = createEvidence({
      marketContext: {
        ...createEvidence().marketContext,
        evidenceId: "sale-comp-1",
      },
    });
    expect(() => normalizePriceDecisionEvidence(duplicateEvidence)).toThrow(
      InvalidPriceDecisionEvidenceError,
    );

    const duplicateProperty = createEvidence({
      recordedSales: [
        createSale(1),
        { ...createSale(2), propertyId: "comp-property-1" },
        createSale(3),
      ],
    });
    expect(() => normalizePriceDecisionEvidence(duplicateProperty)).toThrow(
      InvalidPriceDecisionEvidenceError,
    );
  });

  it("rejects future observations and ambiguous active listing prices", () => {
    expect(() =>
      normalizePriceDecisionEvidence(
        createEvidence({
          recordedSales: [{ ...createSale(1), saleDate: "2026-09-02" }],
        }),
      ),
    ).toThrow(InvalidPriceDecisionEvidenceError);

    expect(() =>
      normalizePriceDecisionEvidence(
        createEvidence({
          targetListing: {
            ...createEvidence().targetListing,
            currentListPrice: null,
          },
        }),
      ),
    ).toThrow(InvalidPriceDecisionEvidenceError);
  });

  it("rejects impossible construction and inconsistent market counts", () => {
    expect(() =>
      normalizePriceDecisionEvidence(
        createEvidence({
          subject: { ...createEvidence().subject, yearBuilt: 2027 },
        }),
      ),
    ).toThrow(InvalidPriceDecisionEvidenceError);

    expect(() =>
      normalizePriceDecisionEvidence(
        createEvidence({
          marketContext: {
            ...createEvidence().marketContext,
            newListings: 121,
            totalListings: 120,
          },
        }),
      ),
    ).toThrow(InvalidPriceDecisionEvidenceError);
  });
});

describe("EstimatePropertyPrice", () => {
  it("normalizes input and orchestrates provider-neutral evidence and engine ports", async () => {
    const evidenceProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence(),
    });
    const engine = new FakePriceDecisionEngine({
      type: "success",
      result: createResult(),
    });
    const useCase = new EstimatePropertyPrice({
      engine,
      evidenceProvider,
      now: () => new Date(evaluatedAt),
    });

    const prepared = await useCase.prepare({
      address: {
        streetAddress: "  123   Main St ",
        city: " Irvine ",
        zipCode: "92612",
      },
      mode: "offer",
    });

    expect(evidenceProvider.calls).toEqual([
      {
        address: {
          streetAddress: "123 Main St",
          city: "Irvine",
          state: "CA",
          zipCode: "92612",
        },
      },
    ]);
    expect(engine.calls).toEqual([
      {
        address: evidenceProvider.calls[0]?.address,
        evidence: prepared.evidence,
        evaluatedAt,
        mode: "offer",
      },
    ]);
    expect(prepared.result).toEqual(normalizePriceDecisionResult(createResult()));
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.result)).toBe(true);
  });

  it("returns only the bounded result from execute", async () => {
    const useCase = createUseCase();

    await expect(
      useCase.execute({ address: inputAddress, mode: "offer" }),
    ).resolves.toEqual(normalizePriceDecisionResult(createResult()));
  });

  it.each([
    null,
    {},
    { address: inputAddress, mode: "offer", extra: true },
    { address: { ...inputAddress, state: "CA" }, mode: "offer" },
    { address: inputAddress, mode: "Offer" },
  ])("rejects invalid input before calling a dependency: %o", async (input) => {
    const evidenceProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence(),
    });
    const engine = new FakePriceDecisionEngine({
      type: "success",
      result: createResult(),
    });
    const useCase = new EstimatePropertyPrice({
      engine,
      evidenceProvider,
      now: () => new Date(evaluatedAt),
    });

    await expect(useCase.execute(input as never)).rejects.toThrow(
      InvalidPriceDecisionInputError,
    );
    expect(evidenceProvider.calls).toEqual([]);
    expect(engine.calls).toEqual([]);
  });

  it("rejects an invalid clock before acquiring billable evidence", async () => {
    const evidenceProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence(),
    });
    const useCase = new EstimatePropertyPrice({
      engine: new FakePriceDecisionEngine({
        type: "success",
        result: createResult(),
      }),
      evidenceProvider,
      now: () => new Date(Number.NaN),
    });

    await expect(
      useCase.execute({ address: inputAddress, mode: "offer" }),
    ).rejects.toThrow(InvalidPriceDecisionClockError);
    expect(evidenceProvider.calls).toEqual([]);
  });

  it("passes a caller abort signal without placing it in the business input", async () => {
    const evidenceProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence(),
    });
    const useCase = new EstimatePropertyPrice({
      engine: new FakePriceDecisionEngine({
        type: "success",
        result: createResult(),
      }),
      evidenceProvider,
      now: () => new Date(evaluatedAt),
    });
    const controller = new AbortController();

    await useCase.execute(
      { address: inputAddress, mode: "offer" },
      controller.signal,
    );

    expect(evidenceProvider.calls[0]?.signal).toBe(controller.signal);
  });

  it("fails closed on malformed or contradictory provider evidence", async () => {
    const malformedProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence(),
    });
    malformedProvider.returnUnsafeEvidence({ ...createEvidence(), extra: true });
    await expect(
      createUseCase({ evidenceProvider: malformedProvider }).execute({
        address: inputAddress,
        mode: "offer",
      }),
    ).rejects.toThrow(InvalidPriceDecisionEvidenceResultError);

    const wrongZipProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence({
        subject: { ...createEvidence().subject, zipCode: "92618" },
      }),
    });
    await expect(
      createUseCase({ evidenceProvider: wrongZipProvider }).execute({
        address: inputAddress,
        mode: "offer",
      }),
    ).rejects.toThrow(ContradictoryPriceDecisionEvidenceError);

    const futureProvider = new FakePriceDecisionEvidenceProvider({
      type: "success",
      evidence: createEvidence({
        acquiredAt: "2026-09-02T17:59:00.000Z",
        externalValueEstimate: {
          ...createEvidence().externalValueEstimate,
          retrievedAt: "2026-09-02T17:58:00.000Z",
        },
      }),
    });
    await expect(
      createUseCase({ evidenceProvider: futureProvider }).execute({
        address: inputAddress,
        mode: "offer",
      }),
    ).rejects.toThrow(ContradictoryPriceDecisionEvidenceError);
  });

  it.each([
    new PriceDecisionSubjectNotFoundError(),
    new PriceDecisionEvidenceUnavailableError(),
    new InsufficientPriceDecisionEvidenceError(),
    new ContradictoryPriceDecisionEvidenceError(),
  ])("preserves bounded dependency error %s", async (failure) => {
    const evidenceFailures = [
      PriceDecisionSubjectNotFoundError,
      PriceDecisionEvidenceUnavailableError,
    ];
    const evidenceFailure = evidenceFailures.some(
      (errorType) => failure instanceof errorType,
    );
    const useCase = new EstimatePropertyPrice({
      evidenceProvider: new FakePriceDecisionEvidenceProvider(
        evidenceFailure
          ? { type: "failure", error: failure }
          : { type: "success", evidence: createEvidence() },
      ),
      engine: new FakePriceDecisionEngine(
        evidenceFailure
          ? { type: "success", result: createResult() }
          : { type: "failure", error: failure },
      ),
      now: () => new Date(evaluatedAt),
    });

    await expect(
      useCase.execute({ address: inputAddress, mode: "offer" }),
    ).rejects.toBe(failure);
  });

  it("rejects invalid result rounding, confidence, scenario, and evidence references", async () => {
    const invalidResults = [
      createResult({ recommendedPrice: 1_385_500 }),
      createResult({ confidence: "low", limitations: [] }),
      createResult({
        scenarios: createResult().scenarios.map((scenario) =>
          scenario.kind === "competitive"
            ? { ...scenario, price: 1_340_000 }
            : scenario,
        ),
      }),
      createResult({
        factors: [
          {
            ...createResult().factors[0],
            evidenceIds: ["unknown-evidence"],
          },
        ],
      }),
    ];

    for (const result of invalidResults) {
      const engine = new FakePriceDecisionEngine({
        type: "success",
        result: result as PriceDecisionResult,
      });
      await expect(
        createUseCase({ engine }).execute({
          address: inputAddress,
          mode: "offer",
        }),
      ).rejects.toThrow(InvalidPriceDecisionResultError);
    }
  });

  it("canonicalizes result ordering and requires confidence limitations", () => {
    const result = normalizePriceDecisionResult(
      createResult({
        factors: [...createResult().factors].reverse(),
        limitations: [...createResult().limitations].reverse(),
        scoredComparables: [...createResult().scoredComparables].reverse(),
        scenarios: [...createResult().scenarios].reverse(),
      }),
    );

    expect(result.scenarios.map((scenario) => scenario.kind)).toEqual([
      "conservative",
      "recommended",
      "competitive",
    ]);
    expect(result.scoredComparables.map((item) => item.evidenceId)).toEqual([
      "sale-comp-1",
      "sale-comp-2",
      "sale-comp-3",
    ]);
    expect(result.factors.map((factor) => factor.rank)).toEqual([1, 2]);
    expect(result.limitations.map((limitation) => limitation.code)).toEqual([
      "condition-unknown",
      "market-context",
    ]);
  });

  it("accepts only the listing-mode scenario set and canonical order", () => {
    const listingResult = normalizePriceDecisionResult(
      createResult({
        mode: "listing",
        recommendedPrice: 1_400_000,
        scenarios: [
          {
            kind: "stretch",
            price: 1_420_000,
            label: "Stretch",
            tradeoff: "Tests the upper supported range with higher stale risk.",
          },
          {
            kind: "quick-sale",
            price: 1_370_000,
            label: "Quick sale",
            tradeoff: "Positions lower in the supported range for early interest.",
          },
          {
            kind: "balanced",
            price: 1_400_000,
            label: "Balanced",
            tradeoff: "Balances supported value and time-on-market risk.",
          },
        ],
      }),
    );

    expect(listingResult.scenarios.map((scenario) => scenario.kind)).toEqual([
      "quick-sale",
      "balanced",
      "stretch",
    ]);
    expect(() =>
      normalizePriceDecisionResult(
        createResult({ mode: "listing" }),
      ),
    ).toThrow(InvalidPriceDecisionResultError);
  });

  it("rejects a structurally valid result for the wrong requested mode", async () => {
    await expect(
      createUseCase().execute({ address: inputAddress, mode: "listing" }),
    ).rejects.toThrow(InvalidPriceDecisionResultError);
  });
});

function createUseCase(
  overrides: {
    evidenceProvider?: FakePriceDecisionEvidenceProvider;
    engine?: FakePriceDecisionEngine;
  } = {},
): EstimatePropertyPrice {
  return new EstimatePropertyPrice({
    evidenceProvider:
      overrides.evidenceProvider ??
      new FakePriceDecisionEvidenceProvider({
        type: "success",
        evidence: createEvidence(),
      }),
    engine:
      overrides.engine ??
      new FakePriceDecisionEngine({
        type: "success",
        result: createResult(),
      }),
    now: () => new Date(evaluatedAt),
  });
}

function createEvidence(
  overrides: Record<string, unknown> = {},
): PriceDecisionEvidence {
  return {
    acquiredAt: "2026-09-01T17:59:00.000Z",
    subject: {
      propertyId: "subject-property",
      formattedAddress: "123 Main St, Irvine, CA 92612",
      city: "Irvine",
      state: "CA",
      zipCode: "92612",
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 3,
      squareFootage: 2450,
      lotSize: 5000,
      yearBuilt: 1998,
      latitude: 33.68,
      longitude: -117.82,
    },
    recordedSales: [createSale(2), createSale(3), createSale(1)],
    targetListing: {
      evidenceId: "target-listing",
      status: "active",
      currentListPrice: 1_450_000,
      listedDate: "2026-07-16",
      lastSeenDate: "2026-09-01",
      daysOnMarket: 47,
      events: [
        {
          evidenceId: "listing-event-2",
          kind: "price-change",
          occurredOn: "2026-08-20",
          price: 1_450_000,
        },
        {
          evidenceId: "listing-event-1",
          kind: "listed",
          occurredOn: "2026-07-16",
          price: 1_490_000,
        },
      ],
    },
    marketContext: {
      evidenceId: "zip-market",
      zipCode: "92612",
      lastUpdatedDate: "2026-09-01",
      medianListPrice: 1_420_000,
      medianPricePerSquareFoot: 590,
      medianDaysOnMarket: 31,
      totalListings: 120,
      newListings: 24,
    },
    externalValueEstimate: {
      evidenceId: "external-avm",
      providerName: "RentCast",
      estimate: 1_405_000,
      rangeLow: 1_340_000,
      rangeHigh: 1_460_000,
      retrievedAt: "2026-09-01T17:58:00.000Z",
    },
    ...overrides,
  } as PriceDecisionEvidence;
}

function createSale(index: number) {
  const saleDates = ["2026-06-15", "2026-05-20", "2026-04-10"];
  return {
    evidenceId: `sale-comp-${index}`,
    source: "recorded-sale" as const,
    propertyId: `comp-property-${index}`,
    formattedAddress: `${100 + index} Comparable St, Irvine, CA 92612`,
    salePrice: 1_350_000 + index * 20_000,
    saleDate: saleDates[index - 1],
    distanceMiles: index * 0.2,
    propertyType: "Single Family" as const,
    bedrooms: 4,
    bathrooms: 3,
    squareFootage: 2300 + index * 40,
    lotSize: 4800 + index * 50,
    yearBuilt: 1995 + index,
    latitude: 33.68 + index * 0.001,
    longitude: -117.82 - index * 0.001,
  };
}

function createResult(
  overrides: Record<string, unknown> = {},
): PriceDecisionResult {
  return {
    methodologyVersion: PRICE_DECISION_METHODOLOGY_VERSION,
    mode: "offer",
    subjectPropertyId: "subject-property",
    currency: "USD",
    evaluatedAt,
    marketValueAnchor: 1_400_000,
    recommendedPrice: 1_385_000,
    rangeLow: 1_350_000,
    rangeHigh: 1_420_000,
    confidence: "medium",
    flexibilitySignal: "medium",
    scenarios: [
      {
        kind: "conservative",
        price: 1_350_000,
        label: "Conservative",
        tradeoff: "Lower entry point with greater rejection risk.",
      },
      {
        kind: "recommended",
        price: 1_385_000,
        label: "Recommended",
        tradeoff: "Balances comparable evidence and observable leverage.",
      },
      {
        kind: "competitive",
        price: 1_415_000,
        label: "Competitive",
        tradeoff: "Improves competitiveness inside the evidence range.",
      },
    ],
    scoredComparables: [
      { evidenceId: "sale-comp-2", similarityScore: 0.86 },
      { evidenceId: "sale-comp-3", similarityScore: 0.82 },
      { evidenceId: "sale-comp-1", similarityScore: 0.91 },
    ],
    factors: [
      {
        factorId: "listing-leverage",
        rank: 2,
        title: "Observable listing leverage",
        detail: "Days on market and a verified reduction support negotiation room.",
        direction: "supports-lower",
        impact: "medium",
        evidenceIds: ["target-listing", "listing-event-2", "zip-market"],
      },
      {
        factorId: "recorded-sales",
        rank: 1,
        title: "Recent recorded sales",
        detail: "The strongest comparable evidence centers near the anchor.",
        direction: "neutral",
        impact: "high",
        evidenceIds: ["sale-comp-1", "sale-comp-2", "sale-comp-3"],
      },
    ],
    limitations: [
      {
        code: "market-context",
        message: "ZIP statistics can hide neighborhood variation.",
      },
      {
        code: "condition-unknown",
        message: "Interior condition and renovations are not modeled.",
      },
    ],
    ...overrides,
  } as PriceDecisionResult;
}
