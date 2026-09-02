import {
  ContradictoryPriceDecisionEvidenceError,
  InsufficientPriceDecisionEvidenceError,
  normalizePriceDecisionResult,
  PRICE_DECISION_METHODOLOGY_VERSION,
  PRICE_DECISION_PRESENTATION_INCREMENT,
  type PriceDecisionConfidence,
  type PriceDecisionEngineInput,
  type PriceDecisionEnginePort,
  type PriceDecisionFactor,
  type PriceDecisionLimitation,
  type PriceDecisionResult,
  type PriceDecisionScenario,
} from "./estimatePropertyPrice.js";
import type {
  PriceDecisionEvidence,
  PriceDecisionSubject,
  PriceDecisionTargetListing,
  RecordedSaleComparable,
} from "./priceDecisionEvidence.js";

export const PRICE_DECISION_ENGINE_CONFIG = Object.freeze({
  minimumComparableCount: 3,
  strongComparableCount: 5,
  maximumComparableCount: 10,
  maximumSaleAgeDays: 365,
  preferredSaleAgeDays: 180,
  maximumDistanceMiles: 5,
  preferredDistanceMiles: 1,
  expandedDistanceMiles: 3,
  preferredSquareFootageDifferenceRatio: 0.2,
  expandedSquareFootageDifferenceRatio: 0.35,
  minimumSimilarityScore: 0.45,
  strongMedianSimilarityScore: 0.75,
  conditionUncertaintyRatio: 0.04,
  sparseThreeCompRangeAddition: 0.02,
  sparseFourCompRangeAddition: 0.01,
  expandedPoolRangeAddition: 0.015,
  hardPoolRangeAddition: 0.03,
  missingStructuralRangeAddition: 0.01,
  maximumRangeHalfWidthRatio: 0.2,
  materialAvmDifferenceRatio: 0.1,
  contradictoryAvmDifferenceRatio: 0.35,
  mediumOfferLeverageRatio: 0.01,
  maximumOfferLeverageRatio: 0.025,
  offerConservativeStepRatio: 0.02,
  offerCompetitiveStepRatio: 0.01,
  listingQuickSaleStepRatio: 0.02,
  listingStretchStepRatio: 0.025,
});

const minimumRoundedMoney = PRICE_DECISION_PRESENTATION_INCREMENT;
const maximumRoundedMoney = 2_147_483_000;

type ComparablePoolStage = "preferred" | "expanded" | "hard";

interface ScoredComparable {
  readonly sale: RecordedSaleComparable;
  readonly score: number;
  readonly indication: number;
  readonly ageDays: number;
  readonly structuralCompleteness: number;
}

interface ComparableSelection {
  readonly selected: readonly ScoredComparable[];
  readonly excludedOutlierEvidenceIds: readonly string[];
  readonly stage: ComparablePoolStage;
  readonly excludedForMissingSquareFootage: number;
}

interface FlexibilityAssessment {
  readonly signal: PriceDecisionResult["flexibilitySignal"];
  readonly adjustmentRatio: number;
  readonly priceReductionCount: number;
  readonly totalReductionPercent: number;
  readonly evidenceIds: readonly string[];
}

interface RangeAssessment {
  readonly low: number;
  readonly high: number;
  readonly robustDispersionRatio: number;
  readonly avmDifferenceRatio: number | null;
  readonly avmMateriallyDisagrees: boolean;
}

export class DeterministicPriceDecisionEngine
  implements PriceDecisionEnginePort
{
  estimate(input: PriceDecisionEngineInput): PriceDecisionResult {
    const selection = selectComparables(input.evidence, input.evaluatedAt);
    const anchor = weightedMedian(
      selection.selected.map((comparable) => ({
        value: comparable.indication,
        weight: comparable.score,
      })),
    );
    const roundedAnchor = roundMoney(anchor);
    const range = calculateRange(input.evidence, selection, anchor);
    const flexibility = assessFlexibility(
      input.evidence.targetListing,
      input.evidence,
    );
    const scenarios = createScenarios(
      input.mode,
      roundedAnchor,
      range.low,
      range.high,
      flexibility,
      input.evidence,
    );
    const weaknesses = collectConfidenceWeaknesses(
      input.evidence,
      selection,
      range,
      input.evaluatedAt,
    );
    const confidence = confidenceFromWeaknesses(weaknesses);
    const limitations = createLimitations(
      input.evidence,
      selection,
      range,
      weaknesses,
      input.evaluatedAt,
    );
    const factors = createFactors(
      input,
      selection,
      roundedAnchor,
      range,
      flexibility,
    );

    return normalizePriceDecisionResult({
      methodologyVersion: PRICE_DECISION_METHODOLOGY_VERSION,
      mode: input.mode,
      subjectPropertyId: input.evidence.subject.propertyId,
      currency: "USD",
      evaluatedAt: input.evaluatedAt,
      marketValueAnchor: roundedAnchor,
      recommendedPrice: scenarios[1].price,
      rangeLow: range.low,
      rangeHigh: range.high,
      confidence,
      flexibilitySignal: flexibility.signal,
      scenarios,
      scoredComparables: selection.selected.map((comparable) => ({
        evidenceId: comparable.sale.evidenceId,
        similarityScore: comparable.score,
      })),
      factors,
      limitations,
    });
  }
}

function selectComparables(
  evidence: PriceDecisionEvidence,
  evaluatedAt: string,
): ComparableSelection {
  const subjectSquareFootage = evidence.subject.squareFootage;
  if (subjectSquareFootage === null) {
    throw new InsufficientPriceDecisionEvidenceError();
  }

  let excludedForMissingSquareFootage = 0;
  const hardEligible: ScoredComparable[] = [];
  for (const sale of evidence.recordedSales) {
    const ageDays = differenceInDays(evaluatedAt.slice(0, 10), sale.saleDate);
    if (
      ageDays < 0 ||
      ageDays > PRICE_DECISION_ENGINE_CONFIG.maximumSaleAgeDays ||
      sale.distanceMiles > PRICE_DECISION_ENGINE_CONFIG.maximumDistanceMiles ||
      !sameBroadPropertyType(evidence.subject.propertyType, sale.propertyType)
    ) {
      continue;
    }
    if (sale.squareFootage === null) {
      excludedForMissingSquareFootage += 1;
      continue;
    }
    const scoreAssessment = calculateSimilarity(
      evidence.subject,
      sale,
      ageDays,
    );
    if (
      scoreAssessment.score <
      PRICE_DECISION_ENGINE_CONFIG.minimumSimilarityScore
    ) {
      continue;
    }
    const indication =
      (sale.salePrice / sale.squareFootage) * subjectSquareFootage;
    if (
      !Number.isFinite(indication) ||
      indication < minimumRoundedMoney ||
      indication > maximumRoundedMoney
    ) {
      continue;
    }
    hardEligible.push({
      sale,
      score: scoreAssessment.score,
      indication,
      ageDays,
      structuralCompleteness: scoreAssessment.structuralCompleteness,
    });
  }

  if (
    hardEligible.length < PRICE_DECISION_ENGINE_CONFIG.minimumComparableCount
  ) {
    throw new InsufficientPriceDecisionEvidenceError();
  }

  const preferred = hardEligible.filter((comparable) =>
    isPreferredComparable(evidence.subject, comparable),
  );
  const expanded = hardEligible.filter((comparable) =>
    isExpandedComparable(evidence.subject, comparable),
  );
  const stage: ComparablePoolStage =
    preferred.length >= PRICE_DECISION_ENGINE_CONFIG.minimumComparableCount
      ? "preferred"
      : expanded.length >= PRICE_DECISION_ENGINE_CONFIG.minimumComparableCount
        ? "expanded"
        : "hard";
  const stagePool =
    stage === "preferred"
      ? preferred
      : stage === "expanded"
        ? expanded
        : hardEligible;
  const outlierEvidenceIds = identifyOutliers(stagePool);
  const withoutOutliers = stagePool.filter(
    (comparable) => !outlierEvidenceIds.has(comparable.sale.evidenceId),
  );
  const usablePool =
    withoutOutliers.length >= PRICE_DECISION_ENGINE_CONFIG.minimumComparableCount
      ? withoutOutliers
      : stagePool;
  const appliedOutlierIds =
    usablePool === withoutOutliers ? [...outlierEvidenceIds].sort() : [];
  const selected = usablePool
    .sort(compareScoredComparables)
    .slice(0, PRICE_DECISION_ENGINE_CONFIG.maximumComparableCount);

  if (selected.length < PRICE_DECISION_ENGINE_CONFIG.minimumComparableCount) {
    throw new InsufficientPriceDecisionEvidenceError();
  }

  return {
    selected,
    excludedOutlierEvidenceIds: appliedOutlierIds,
    stage,
    excludedForMissingSquareFootage,
  };
}

function calculateSimilarity(
  subject: PriceDecisionSubject,
  sale: RecordedSaleComparable,
  ageDays: number,
): { score: number; structuralCompleteness: number } {
  const components: Array<{ weight: number; value: number }> = [
    {
      weight: 0.2,
      value: subject.propertyType === sale.propertyType ? 1 : 0.7,
    },
    {
      weight: 0.2,
      value: ratioSimilarity(subject.squareFootage, sale.squareFootage, 0.5),
    },
    {
      weight: 0.2,
      value: clamp(1 - sale.distanceMiles / 5, 0, 1),
    },
    {
      weight: 0.15,
      value: clamp(1 - ageDays / 365, 0, 1),
    },
  ];
  let optionalPossible = 0;
  let optionalAvailable = 0;
  addOptionalComponent(components, subject.bedrooms, sale.bedrooms, 0.1, 3);
  optionalPossible += 1;
  if (subject.bedrooms !== null && sale.bedrooms !== null) {
    optionalAvailable += 1;
  }
  addOptionalComponent(components, subject.bathrooms, sale.bathrooms, 0.05, 3);
  optionalPossible += 1;
  if (subject.bathrooms !== null && sale.bathrooms !== null) {
    optionalAvailable += 1;
  }
  addOptionalComponent(components, subject.yearBuilt, sale.yearBuilt, 0.05, 50);
  optionalPossible += 1;
  if (subject.yearBuilt !== null && sale.yearBuilt !== null) {
    optionalAvailable += 1;
  }
  if (usesLotSize(subject.propertyType)) {
    optionalPossible += 1;
    if (subject.lotSize !== null && sale.lotSize !== null) {
      optionalAvailable += 1;
      components.push({
        weight: 0.05,
        value: ratioSimilarity(subject.lotSize, sale.lotSize, 0.75),
      });
    }
  }

  const totalWeight = components.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  const weightedScore = components.reduce(
    (sum, component) => sum + component.weight * component.value,
    0,
  );
  return {
    score: roundDecimal(weightedScore / totalWeight, 4),
    structuralCompleteness:
      optionalPossible === 0 ? 1 : optionalAvailable / optionalPossible,
  };
}

function addOptionalComponent(
  components: Array<{ weight: number; value: number }>,
  subjectValue: number | null,
  saleValue: number | null,
  weight: number,
  maximumDifference: number,
): void {
  if (subjectValue === null || saleValue === null) return;
  components.push({
    weight,
    value: clamp(
      1 - Math.abs(subjectValue - saleValue) / maximumDifference,
      0,
      1,
    ),
  });
}

function isPreferredComparable(
  subject: PriceDecisionSubject,
  comparable: ScoredComparable,
): boolean {
  const sale = comparable.sale;
  return (
    comparable.ageDays <= PRICE_DECISION_ENGINE_CONFIG.preferredSaleAgeDays &&
    sale.distanceMiles <= PRICE_DECISION_ENGINE_CONFIG.preferredDistanceMiles &&
    sale.propertyType === subject.propertyType &&
    relativeDifference(subject.squareFootage, sale.squareFootage) <=
      PRICE_DECISION_ENGINE_CONFIG.preferredSquareFootageDifferenceRatio &&
    withinOptionalDifference(subject.bedrooms, sale.bedrooms, 1) &&
    withinOptionalDifference(subject.bathrooms, sale.bathrooms, 1) &&
    withinOptionalDifference(subject.yearBuilt, sale.yearBuilt, 20) &&
    (!usesLotSize(subject.propertyType) ||
      withinOptionalRatio(subject.lotSize, sale.lotSize, 0.35))
  );
}

function isExpandedComparable(
  subject: PriceDecisionSubject,
  comparable: ScoredComparable,
): boolean {
  const sale = comparable.sale;
  return (
    sale.distanceMiles <= PRICE_DECISION_ENGINE_CONFIG.expandedDistanceMiles &&
    sale.propertyType === subject.propertyType &&
    relativeDifference(subject.squareFootage, sale.squareFootage) <=
      PRICE_DECISION_ENGINE_CONFIG.expandedSquareFootageDifferenceRatio &&
    withinOptionalDifference(subject.bedrooms, sale.bedrooms, 2) &&
    withinOptionalDifference(subject.bathrooms, sale.bathrooms, 2) &&
    withinOptionalDifference(subject.yearBuilt, sale.yearBuilt, 30) &&
    (!usesLotSize(subject.propertyType) ||
      withinOptionalRatio(subject.lotSize, sale.lotSize, 0.5))
  );
}

function identifyOutliers(
  comparables: readonly ScoredComparable[],
): ReadonlySet<string> {
  if (comparables.length < 5) return new Set();
  const pricePerSquareFoot = comparables.map(
    (comparable) =>
      comparable.sale.salePrice / (comparable.sale.squareFootage ?? 1),
  );
  const center = median(pricePerSquareFoot);
  const absoluteDeviations = pricePerSquareFoot.map((value) =>
    Math.abs(value - center),
  );
  const mad = median(absoluteDeviations);
  const outlierIds = new Set<string>();
  for (const [index, value] of pricePerSquareFoot.entries()) {
    const extreme =
      mad === 0
        ? Math.abs(value - center) / center > 0.3
        : (0.6745 * Math.abs(value - center)) / mad > 3.5;
    if (extreme) {
      const evidenceId = comparables[index]?.sale.evidenceId;
      if (evidenceId !== undefined) outlierIds.add(evidenceId);
    }
  }
  return outlierIds;
}

function calculateRange(
  evidence: PriceDecisionEvidence,
  selection: ComparableSelection,
  anchor: number,
): RangeAssessment {
  const indicationDeviations = selection.selected.map((comparable) =>
    Math.abs(comparable.indication - anchor),
  );
  const robustDispersionRatio =
    (median(indicationDeviations) * 1.4826) / anchor;
  let halfWidthRatio = Math.max(
    PRICE_DECISION_ENGINE_CONFIG.conditionUncertaintyRatio,
    robustDispersionRatio,
  );
  if (selection.selected.length === 3) {
    halfWidthRatio += PRICE_DECISION_ENGINE_CONFIG.sparseThreeCompRangeAddition;
  } else if (selection.selected.length === 4) {
    halfWidthRatio += PRICE_DECISION_ENGINE_CONFIG.sparseFourCompRangeAddition;
  }
  if (selection.stage === "expanded") {
    halfWidthRatio += PRICE_DECISION_ENGINE_CONFIG.expandedPoolRangeAddition;
  } else if (selection.stage === "hard") {
    halfWidthRatio += PRICE_DECISION_ENGINE_CONFIG.hardPoolRangeAddition;
  }
  if (median(selection.selected.map((item) => item.structuralCompleteness)) < 0.75) {
    halfWidthRatio += PRICE_DECISION_ENGINE_CONFIG.missingStructuralRangeAddition;
  }

  const avm = evidence.externalValueEstimate;
  const avmDifferenceRatio =
    avm === null ? null : Math.abs(avm.estimate - anchor) / anchor;
  const rawComparableLow = anchor * (1 - halfWidthRatio);
  const rawComparableHigh = anchor * (1 + halfWidthRatio);
  const avmDoesNotOverlap =
    avm !== null &&
    (avm.rangeHigh < rawComparableLow || avm.rangeLow > rawComparableHigh);
  if (
    avmDifferenceRatio !== null &&
    avmDifferenceRatio >
      PRICE_DECISION_ENGINE_CONFIG.contradictoryAvmDifferenceRatio &&
    avmDoesNotOverlap
  ) {
    throw new ContradictoryPriceDecisionEvidenceError();
  }
  const avmMateriallyDisagrees =
    avmDifferenceRatio !== null &&
    avmDifferenceRatio >
      PRICE_DECISION_ENGINE_CONFIG.materialAvmDifferenceRatio &&
    avmDoesNotOverlap;
  if (avmMateriallyDisagrees && avmDifferenceRatio !== null) {
    halfWidthRatio = Math.max(halfWidthRatio, avmDifferenceRatio / 2);
  }
  halfWidthRatio = Math.min(
    halfWidthRatio,
    PRICE_DECISION_ENGINE_CONFIG.maximumRangeHalfWidthRatio,
  );

  return {
    low: floorMoney(anchor * (1 - halfWidthRatio)),
    high: ceilMoney(anchor * (1 + halfWidthRatio)),
    robustDispersionRatio,
    avmDifferenceRatio,
    avmMateriallyDisagrees,
  };
}

function assessFlexibility(
  listing: PriceDecisionTargetListing | null,
  evidence: PriceDecisionEvidence,
): FlexibilityAssessment {
  if (listing === null) {
    return {
      signal: "unknown",
      adjustmentRatio: 0,
      priceReductionCount: 0,
      totalReductionPercent: 0,
      evidenceIds: [],
    };
  }
  const priceReductionCount = countVerifiedPriceReductions(listing);
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
      ? ((firstKnownPrice - listing.currentListPrice) / firstKnownPrice) * 100
      : 0;
  let points = 0;
  const marketDays = evidence.marketContext?.medianDaysOnMarket;
  if (
    listing.daysOnMarket !== null &&
    marketDays !== undefined &&
    marketDays !== null &&
    marketDays > 0
  ) {
    const ratio = listing.daysOnMarket / marketDays;
    points += ratio >= 1.5 ? 2 : ratio >= 1.15 ? 1 : 0;
  }
  points += totalReductionPercent >= 5 ? 2 : priceReductionCount > 0 ? 1 : 0;
  if (listing.events.some((event) => event.kind === "relisted")) points += 1;

  const signal = points >= 3 ? "high" : points >= 1 ? "medium" : "low";
  return {
    signal,
    adjustmentRatio:
      signal === "high"
        ? PRICE_DECISION_ENGINE_CONFIG.maximumOfferLeverageRatio
        : signal === "medium"
          ? PRICE_DECISION_ENGINE_CONFIG.mediumOfferLeverageRatio
          : 0,
    priceReductionCount,
    totalReductionPercent: roundDecimal(totalReductionPercent, 1),
    evidenceIds: [
      listing.evidenceId,
      ...listing.events.slice(-19).map((event) => event.evidenceId),
    ],
  };
}

function createScenarios(
  mode: PriceDecisionEngineInput["mode"],
  anchor: number,
  rangeLow: number,
  rangeHigh: number,
  flexibility: FlexibilityAssessment,
  evidence: PriceDecisionEvidence,
): [PriceDecisionScenario, PriceDecisionScenario, PriceDecisionScenario] {
  if (mode === "offer") {
    const recommended = boundedMoney(
      anchor * (1 - flexibility.adjustmentRatio),
      rangeLow,
      rangeHigh,
    );
    return [
      {
        kind: "conservative",
        price: boundedMoney(
          anchor *
            (1 -
              flexibility.adjustmentRatio -
              PRICE_DECISION_ENGINE_CONFIG.offerConservativeStepRatio),
          rangeLow,
          recommended,
        ),
        label: "Conservative",
        tradeoff: "Lower supported entry point with greater rejection risk.",
      },
      {
        kind: "recommended",
        price: recommended,
        label: "Recommended",
        tradeoff:
          flexibility.signal === "medium" || flexibility.signal === "high"
            ? "Balances recorded-sale value with observable listing leverage."
            : "Centers on recorded-sale value without assuming seller motivation.",
      },
      {
        kind: "competitive",
        price: boundedMoney(
          anchor * (1 + PRICE_DECISION_ENGINE_CONFIG.offerCompetitiveStepRatio),
          recommended,
          rangeHigh,
        ),
        label: "Competitive",
        tradeoff: "Improves competitiveness while staying inside the evidence range.",
      },
    ];
  }

  const checkpoint = reviewCheckpointDays(evidence);
  const balanced = boundedMoney(anchor, rangeLow, rangeHigh);
  return [
    {
      kind: "quick-sale",
      price: boundedMoney(
        anchor * (1 - PRICE_DECISION_ENGINE_CONFIG.listingQuickSaleStepRatio),
        rangeLow,
        balanced,
      ),
      label: "Quick sale",
      tradeoff: "Positions lower in the supported range to encourage early interest.",
    },
    {
      kind: "balanced",
      price: balanced,
      label: "Balanced",
      tradeoff: `Uses the market-value anchor with a ${checkpoint}-day review checkpoint.`,
    },
    {
      kind: "stretch",
      price: boundedMoney(
        anchor * (1 + PRICE_DECISION_ENGINE_CONFIG.listingStretchStepRatio),
        balanced,
        rangeHigh,
      ),
      label: "Stretch",
      tradeoff:
        `Tests the upper supported range; review after ${checkpoint} days ` +
        "if response is weak.",
    },
  ];
}

function collectConfidenceWeaknesses(
  evidence: PriceDecisionEvidence,
  selection: ComparableSelection,
  range: RangeAssessment,
  evaluatedAt: string,
): ReadonlySet<string> {
  const weaknesses = new Set<string>();
  if (
    selection.selected.length <
    PRICE_DECISION_ENGINE_CONFIG.strongComparableCount
  ) {
    weaknesses.add("sparse-comparables");
  }
  if (selection.stage !== "preferred") {
    weaknesses.add("expanded-comparable-pool");
  }
  if (
    median(selection.selected.map((item) => item.score)) <
    PRICE_DECISION_ENGINE_CONFIG.strongMedianSimilarityScore
  ) {
    weaknesses.add("weaker-similarity");
  }
  if (range.robustDispersionRatio > 0.08) weaknesses.add("high-dispersion");
  if (
    median(selection.selected.map((item) => item.structuralCompleteness)) <
    0.75
  ) {
    weaknesses.add("missing-structural-data");
  }
  if (range.avmMateriallyDisagrees) weaknesses.add("avm-disagreement");
  if (
    evidence.marketContext === null ||
    differenceInDays(
      evaluatedAt.slice(0, 10),
      evidence.marketContext.lastUpdatedDate,
    ) > 60
  ) {
    weaknesses.add("market-context-weak");
  }
  return weaknesses;
}

function confidenceFromWeaknesses(
  weaknesses: ReadonlySet<string>,
): PriceDecisionConfidence {
  if (weaknesses.size === 0) return "high";
  if (weaknesses.size === 1) return "medium";
  return "low";
}

function createFactors(
  input: PriceDecisionEngineInput,
  selection: ComparableSelection,
  anchor: number,
  range: RangeAssessment,
  flexibility: FlexibilityAssessment,
): PriceDecisionFactor[] {
  const factors: Omit<PriceDecisionFactor, "rank">[] = [
    {
      factorId: "recorded-sales-anchor",
      title: "Recent recorded sales",
      detail:
        `${selection.selected.length} selected recorded sales support the ` +
        "market-value anchor.",
      direction: "neutral",
      impact: "high",
      evidenceIds: selection.selected.map((item) => item.sale.evidenceId),
    },
  ];
  if (selection.excludedOutlierEvidenceIds.length > 0) {
    factors.push({
      factorId: "recorded-sale-outlier-screen",
      title: "Recorded-sale outlier screen",
      detail:
        "An extreme price-per-square-foot observation was excluded by the " +
        "fixed MAD rule.",
      direction: "neutral",
      impact: "medium",
      evidenceIds: selection.excludedOutlierEvidenceIds.slice(0, 20),
    });
  }
  if (input.evidence.targetListing !== null) {
    factors.push({
      factorId: "observable-listing-flexibility",
      title: "Observable listing activity",
      detail:
        `${flexibility.priceReductionCount} verified price reductions and ` +
        `${flexibility.totalReductionPercent}% cumulative reduction produce a ` +
        `${flexibility.signal} flexibility inference.`,
      direction:
        input.mode === "offer" &&
        (flexibility.signal === "medium" || flexibility.signal === "high")
          ? "supports-lower"
          : "neutral",
      impact:
        flexibility.signal === "high"
          ? "high"
          : flexibility.signal === "medium"
            ? "medium"
            : "low",
      evidenceIds: flexibility.evidenceIds,
    });
  }
  const avm = input.evidence.externalValueEstimate;
  if (avm !== null) {
    const differenceRatio = (avm.estimate - anchor) / anchor;
    factors.push({
      factorId: "rentcast-avm-calibration",
      title: "RentCast value estimate",
      detail: range.avmMateriallyDisagrees
        ? "The external value estimate materially disagrees with the recorded-sale anchor."
        : "The external value estimate is used as calibration, not as a recorded sale.",
      direction:
        differenceRatio > 0.03
          ? "supports-higher"
          : differenceRatio < -0.03
            ? "supports-lower"
            : "neutral",
      impact:
        Math.abs(differenceRatio) > 0.1
          ? "high"
          : Math.abs(differenceRatio) > 0.05
            ? "medium"
            : "low",
      evidenceIds: [avm.evidenceId],
    });
  }
  if (input.evidence.marketContext !== null) {
    factors.push({
      factorId: "zip-listing-market-context",
      title: "ZIP listing-market context",
      detail: "ZIP statistics provide active-listing context and do not replace recorded sales.",
      direction: "neutral",
      impact: "low",
      evidenceIds: [input.evidence.marketContext.evidenceId],
    });
  }
  return factors.map((factor, index) => ({ ...factor, rank: index + 1 }));
}

function createLimitations(
  evidence: PriceDecisionEvidence,
  selection: ComparableSelection,
  range: RangeAssessment,
  weaknesses: ReadonlySet<string>,
  evaluatedAt: string,
): PriceDecisionLimitation[] {
  const limitations: PriceDecisionLimitation[] = [
    {
      code: "condition-unknown",
      message: "Interior condition, renovations, view, and concessions are not modeled.",
    },
  ];
  if (evidence.targetListing === null) {
    limitations.push({
      code: "listing-context-unavailable",
      message: "Subject listing activity was unavailable, so flexibility is unknown.",
    });
  } else {
    limitations.push({
      code: "seller-flexibility-inference",
      message: "Seller flexibility is inferred only from observable listing activity.",
    });
  }
  if (weaknesses.has("sparse-comparables")) {
    limitations.push({
      code: "sparse-comparables",
      message: "Fewer than five eligible recorded sales were available.",
    });
  }
  if (selection.stage !== "preferred") {
    limitations.push({
      code: "expanded-comparable-pool",
      message: "The comparable pool expanded beyond preferred recency or distance bounds.",
    });
  }
  if (weaknesses.has("weaker-similarity")) {
    limitations.push({
      code: "weaker-similarity",
      message: "Selected comparables have weaker median structural similarity.",
    });
  }
  if (weaknesses.has("high-dispersion")) {
    limitations.push({
      code: "high-dispersion",
      message: "Comparable subject-equivalent price indications have high dispersion.",
    });
  }
  if (
    weaknesses.has("missing-structural-data") ||
    selection.excludedForMissingSquareFootage > 0
  ) {
    limitations.push({
      code: "missing-structural-data",
      message: "Some structural attributes were unavailable and received no neutral score.",
    });
  }
  if (selection.excludedOutlierEvidenceIds.length > 0) {
    limitations.push({
      code: "recorded-sale-outlier",
      message: "An extreme recorded-sale price per square foot was excluded by a robust rule.",
    });
  }
  if (evidence.externalValueEstimate === null) {
    limitations.push({
      code: "avm-unavailable",
      message: "An external value estimate was unavailable for calibration.",
    });
  } else if (range.avmMateriallyDisagrees) {
    limitations.push({
      code: "avm-disagreement",
      message: "The external value estimate materially disagrees with recorded sales.",
    });
  }
  if (evidence.marketContext === null) {
    limitations.push({
      code: "market-context-unavailable",
      message: "Current ZIP listing-market statistics were unavailable.",
    });
  } else if (
    differenceInDays(
      evaluatedAt.slice(0, 10),
      evidence.marketContext.lastUpdatedDate,
    ) > 60
  ) {
    limitations.push({
      code: "market-context-stale",
      message: "ZIP listing-market statistics are more than 60 days old.",
    });
  }
  return deduplicateLimitations(limitations).slice(0, 10);
}

function reviewCheckpointDays(evidence: PriceDecisionEvidence): number {
  const marketDays = evidence.marketContext?.medianDaysOnMarket;
  if (marketDays === undefined || marketDays === null) return 14;
  return Math.round(clamp(marketDays / 2, 7, 21));
}

function countVerifiedPriceReductions(
  listing: PriceDecisionTargetListing,
): number {
  let previousPrice: number | null = null;
  let reductions = 0;
  for (const event of listing.events) {
    if (event.price === null) continue;
    if (
      event.kind === "price-change" &&
      previousPrice !== null &&
      event.price < previousPrice
    ) {
      reductions += 1;
    }
    previousPrice = event.price;
  }
  return reductions;
}

function sameBroadPropertyType(
  subject: PriceDecisionSubject["propertyType"],
  comparable: RecordedSaleComparable["propertyType"],
): boolean {
  return propertyTypeGroup(subject) === propertyTypeGroup(comparable);
}

function propertyTypeGroup(
  value: PriceDecisionSubject["propertyType"],
): string {
  if (value === "Condo" || value === "Townhouse") return "attached";
  if (value === "Multi-Family" || value === "Apartment") return "multifamily";
  return value;
}

function usesLotSize(value: PriceDecisionSubject["propertyType"]): boolean {
  return value === "Single Family" || value === "Manufactured";
}

function compareScoredComparables(
  left: ScoredComparable,
  right: ScoredComparable,
): number {
  return (
    right.score - left.score ||
    right.sale.saleDate.localeCompare(left.sale.saleDate) ||
    left.sale.distanceMiles - right.sale.distanceMiles ||
    left.sale.evidenceId.localeCompare(right.sale.evidenceId)
  );
}

function weightedMedian(
  values: readonly { value: number; weight: number }[],
): number {
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulativeWeight = 0;
  for (const item of sorted) {
    cumulativeWeight += item.weight;
    if (cumulativeWeight >= totalWeight / 2) return item.value;
  }
  const last = sorted.at(-1);
  if (last === undefined) throw new InsufficientPriceDecisionEvidenceError();
  return last.value;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new InsufficientPriceDecisionEvidenceError();
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) throw new InsufficientPriceDecisionEvidenceError();
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  if (left === undefined) throw new InsufficientPriceDecisionEvidenceError();
  return (left + right) / 2;
}

function ratioSimilarity(
  left: number | null,
  right: number | null,
  maximumRatio: number,
): number {
  if (left === null || right === null) return 0;
  return clamp(1 - relativeDifference(left, right) / maximumRatio, 0, 1);
}

function relativeDifference(left: number | null, right: number | null): number {
  if (left === null || right === null || left <= 0 || right <= 0) return Infinity;
  return Math.abs(left - right) / left;
}

function withinOptionalDifference(
  left: number | null,
  right: number | null,
  maximum: number,
): boolean {
  return left === null || right === null || Math.abs(left - right) <= maximum;
}

function withinOptionalRatio(
  left: number | null,
  right: number | null,
  maximum: number,
): boolean {
  return left === null || right === null || relativeDifference(left, right) <= maximum;
}

function differenceInDays(laterDate: string, earlierDate: string): number {
  return Math.floor(
    (Date.parse(`${laterDate}T00:00:00.000Z`) -
      Date.parse(`${earlierDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function boundedMoney(value: number, minimum: number, maximum: number): number {
  return roundMoney(clamp(value, minimum, maximum));
}

function roundMoney(value: number): number {
  return clamp(
    Math.round(value / PRICE_DECISION_PRESENTATION_INCREMENT) *
      PRICE_DECISION_PRESENTATION_INCREMENT,
    minimumRoundedMoney,
    maximumRoundedMoney,
  );
}

function floorMoney(value: number): number {
  return clamp(
    Math.floor(value / PRICE_DECISION_PRESENTATION_INCREMENT) *
      PRICE_DECISION_PRESENTATION_INCREMENT,
    minimumRoundedMoney,
    maximumRoundedMoney,
  );
}

function ceilMoney(value: number): number {
  return clamp(
    Math.ceil(value / PRICE_DECISION_PRESENTATION_INCREMENT) *
      PRICE_DECISION_PRESENTATION_INCREMENT,
    minimumRoundedMoney,
    maximumRoundedMoney,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundDecimal(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function deduplicateLimitations(
  limitations: readonly PriceDecisionLimitation[],
): PriceDecisionLimitation[] {
  const byCode = new Map<string, PriceDecisionLimitation>();
  for (const limitation of limitations) byCode.set(limitation.code, limitation);
  return [...byCode.values()];
}
