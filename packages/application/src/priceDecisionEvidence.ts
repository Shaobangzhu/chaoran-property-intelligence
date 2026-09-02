import { z } from "zod";

import {
  listingPropertyTypes,
  priceDecisionState,
  type PriceDecisionAddress,
} from "@chaoran-property-intelligence/domain";

export const PRICE_DECISION_CONTRACT_LIMITS = Object.freeze({
  evidenceId: 80,
  propertyId: 300,
  formattedAddress: 300,
  providerName: 80,
  maximumRecordedSales: 25,
  maximumListingEvents: 100,
  maximumMoney: 2_147_483_647,
  maximumSquareFootage: 100_000,
  maximumLotSize: 100_000_000,
  maximumDaysOnMarket: 3_650,
});

const evidenceIdSchema = z
  .string()
  .min(1)
  .max(PRICE_DECISION_CONTRACT_LIMITS.evidenceId)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const propertyIdSchema = boundedText(
  PRICE_DECISION_CONTRACT_LIMITS.propertyId,
);
const formattedAddressSchema = boundedText(
  PRICE_DECISION_CONTRACT_LIMITS.formattedAddress,
);
const canonicalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCanonicalDate);
const canonicalTimestampSchema = z
  .string()
  .max(64)
  .refine(isCanonicalTimestamp);
const moneySchema = z
  .number()
  .int()
  .positive()
  .max(PRICE_DECISION_CONTRACT_LIMITS.maximumMoney);
const nullableAttributeCountSchema = z
  .number()
  .min(0)
  .max(100)
  .multipleOf(0.25)
  .nullable();
const nullableSquareFootageSchema = z
  .number()
  .int()
  .positive()
  .max(PRICE_DECISION_CONTRACT_LIMITS.maximumSquareFootage)
  .nullable();
const nullableLotSizeSchema = z
  .number()
  .int()
  .positive()
  .max(PRICE_DECISION_CONTRACT_LIMITS.maximumLotSize)
  .nullable();
const nullableYearBuiltSchema = z
  .number()
  .int()
  .min(1600)
  .max(2200)
  .nullable();
const nullableLatitudeSchema = z.number().min(-90).max(90).nullable();
const nullableLongitudeSchema = z.number().min(-180).max(180).nullable();

const subjectSchema = z
  .strictObject({
    propertyId: propertyIdSchema,
    formattedAddress: formattedAddressSchema,
    city: boundedText(100),
    state: z.literal(priceDecisionState),
    zipCode: z.string().regex(/^\d{5}$/),
    propertyType: z.enum(listingPropertyTypes),
    bedrooms: nullableAttributeCountSchema,
    bathrooms: nullableAttributeCountSchema,
    squareFootage: nullableSquareFootageSchema,
    lotSize: nullableLotSizeSchema,
    yearBuilt: nullableYearBuiltSchema,
    latitude: nullableLatitudeSchema,
    longitude: nullableLongitudeSchema,
  })
  .superRefine(requireCoordinatePair);

const recordedSaleSchema = z
  .strictObject({
    evidenceId: evidenceIdSchema,
    source: z.literal("recorded-sale"),
    propertyId: propertyIdSchema,
    formattedAddress: formattedAddressSchema,
    salePrice: moneySchema,
    saleDate: canonicalDateSchema,
    distanceMiles: z.number().finite().min(0).max(100),
    propertyType: z.enum(listingPropertyTypes),
    bedrooms: nullableAttributeCountSchema,
    bathrooms: nullableAttributeCountSchema,
    squareFootage: nullableSquareFootageSchema,
    lotSize: nullableLotSizeSchema,
    yearBuilt: nullableYearBuiltSchema,
    latitude: nullableLatitudeSchema,
    longitude: nullableLongitudeSchema,
  })
  .superRefine(requireCoordinatePair);

const listingEventSchema = z
  .strictObject({
    evidenceId: evidenceIdSchema,
    kind: z.enum(["listed", "price-change", "removed", "relisted"]),
    occurredOn: canonicalDateSchema,
    price: moneySchema.nullable(),
  })
  .superRefine((event, context) => {
    if (event.kind !== "removed" && event.price === null) {
      context.addIssue({
        code: "custom",
        message: "Listing event price is required",
        path: ["price"],
      });
    }
  });

const targetListingSchema = z.strictObject({
  evidenceId: evidenceIdSchema,
  status: z.enum(["active", "inactive", "unknown"]),
  currentListPrice: moneySchema.nullable(),
  listedDate: canonicalDateSchema.nullable(),
  lastSeenDate: canonicalDateSchema.nullable(),
  daysOnMarket: z
    .number()
    .int()
    .min(0)
    .max(PRICE_DECISION_CONTRACT_LIMITS.maximumDaysOnMarket)
    .nullable(),
  events: z
    .array(listingEventSchema)
    .max(PRICE_DECISION_CONTRACT_LIMITS.maximumListingEvents),
});

const marketContextSchema = z
  .strictObject({
    evidenceId: evidenceIdSchema,
    zipCode: z.string().regex(/^\d{5}$/),
    lastUpdatedDate: canonicalDateSchema,
    medianListPrice: moneySchema.nullable(),
    medianPricePerSquareFoot: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .nullable(),
    medianDaysOnMarket: z
      .number()
      .finite()
      .min(0)
      .max(PRICE_DECISION_CONTRACT_LIMITS.maximumDaysOnMarket)
      .nullable(),
    totalListings: z.number().int().min(0).max(10_000_000).nullable(),
    newListings: z.number().int().min(0).max(10_000_000).nullable(),
  })
  .superRefine((context, refinement) => {
    if (
      context.medianListPrice === null &&
      context.medianPricePerSquareFoot === null &&
      context.medianDaysOnMarket === null &&
      context.totalListings === null &&
      context.newListings === null
    ) {
      refinement.addIssue({
        code: "custom",
        message: "Market context must contain at least one statistic",
      });
    }
  });

const externalValueEstimateSchema = z
  .strictObject({
    evidenceId: evidenceIdSchema,
    providerName: boundedText(PRICE_DECISION_CONTRACT_LIMITS.providerName),
    estimate: moneySchema,
    rangeLow: moneySchema,
    rangeHigh: moneySchema,
    retrievedAt: canonicalTimestampSchema,
  })
  .superRefine((estimate, context) => {
    if (
      estimate.rangeLow > estimate.estimate ||
      estimate.estimate > estimate.rangeHigh
    ) {
      context.addIssue({
        code: "custom",
        message: "External value estimate range is invalid",
      });
    }
  });

const priceDecisionEvidenceSchema = z.strictObject({
  acquiredAt: canonicalTimestampSchema,
  subject: subjectSchema,
  recordedSales: z
    .array(recordedSaleSchema)
    .max(PRICE_DECISION_CONTRACT_LIMITS.maximumRecordedSales),
  targetListing: targetListingSchema.nullable(),
  marketContext: marketContextSchema.nullable(),
  externalValueEstimate: externalValueEstimateSchema.nullable(),
});

type MutablePriceDecisionEvidence = z.infer<typeof priceDecisionEvidenceSchema>;
export type PriceDecisionEvidence = DeepReadonly<MutablePriceDecisionEvidence>;
export type PriceDecisionSubject = PriceDecisionEvidence["subject"];
export type RecordedSaleComparable =
  PriceDecisionEvidence["recordedSales"][number];
export type PriceDecisionTargetListing =
  NonNullable<PriceDecisionEvidence["targetListing"]>;
export type PriceDecisionMarketContext =
  NonNullable<PriceDecisionEvidence["marketContext"]>;
export type ExternalValueEstimate =
  NonNullable<PriceDecisionEvidence["externalValueEstimate"]>;

export interface PriceDecisionEvidenceRequest {
  readonly address: PriceDecisionAddress;
  readonly signal?: AbortSignal;
}

export interface PriceDecisionEvidencePort {
  load(request: PriceDecisionEvidenceRequest): Promise<PriceDecisionEvidence>;
}

export class InvalidPriceDecisionEvidenceError extends Error {
  constructor() {
    super("Price Decision evidence contract was invalid");
    this.name = "InvalidPriceDecisionEvidenceError";
  }
}

export class PriceDecisionSubjectNotFoundError extends Error {
  constructor() {
    super("Price Decision subject was not found");
    this.name = "PriceDecisionSubjectNotFoundError";
  }
}

export class PriceDecisionEvidenceUnavailableError extends Error {
  constructor() {
    super("Price Decision evidence was unavailable");
    this.name = "PriceDecisionEvidenceUnavailableError";
  }
}

export function normalizePriceDecisionEvidence(
  value: unknown,
): PriceDecisionEvidence {
  const parsed = priceDecisionEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    return throwInvalidEvidence();
  }

  const evidence = parsed.data;
  assertEvidenceRelationships(evidence);

  const normalized: MutablePriceDecisionEvidence = {
    ...evidence,
    recordedSales: [...evidence.recordedSales].sort(compareRecordedSales),
    targetListing:
      evidence.targetListing === null
        ? null
        : {
            ...evidence.targetListing,
            events: [...evidence.targetListing.events].sort(
              compareListingEvents,
            ),
          },
  };

  return deepFreeze(normalized);
}

function assertEvidenceRelationships(
  evidence: MutablePriceDecisionEvidence,
): void {
  const acquiredDate = evidence.acquiredAt.slice(0, 10);
  const acquiredYear = Number(acquiredDate.slice(0, 4));
  const evidenceIds: string[] = [];
  const comparablePropertyIds = new Set<string>();

  if (
    evidence.subject.yearBuilt !== null &&
    evidence.subject.yearBuilt > acquiredYear
  ) {
    return throwInvalidEvidence();
  }

  for (const sale of evidence.recordedSales) {
    evidenceIds.push(sale.evidenceId);
    if (
      sale.saleDate > acquiredDate ||
      (sale.yearBuilt !== null &&
        sale.yearBuilt > Number(sale.saleDate.slice(0, 4))) ||
      sale.propertyId === evidence.subject.propertyId ||
      comparablePropertyIds.has(sale.propertyId)
    ) {
      return throwInvalidEvidence();
    }
    comparablePropertyIds.add(sale.propertyId);
  }

  const listing = evidence.targetListing;
  if (listing !== null) {
    evidenceIds.push(listing.evidenceId);
    if (
      (listing.status === "active" && listing.currentListPrice === null) ||
      (listing.listedDate !== null && listing.listedDate > acquiredDate) ||
      (listing.lastSeenDate !== null && listing.lastSeenDate > acquiredDate) ||
      (listing.listedDate !== null &&
        listing.lastSeenDate !== null &&
        listing.listedDate > listing.lastSeenDate)
    ) {
      return throwInvalidEvidence();
    }
    for (const event of listing.events) {
      evidenceIds.push(event.evidenceId);
      if (event.occurredOn > acquiredDate) {
        return throwInvalidEvidence();
      }
    }
  }

  if (evidence.marketContext !== null) {
    evidenceIds.push(evidence.marketContext.evidenceId);
    if (
      evidence.marketContext.lastUpdatedDate > acquiredDate ||
      (evidence.marketContext.newListings !== null &&
        evidence.marketContext.totalListings !== null &&
        evidence.marketContext.newListings >
          evidence.marketContext.totalListings)
    ) {
      return throwInvalidEvidence();
    }
  }

  if (evidence.externalValueEstimate !== null) {
    evidenceIds.push(evidence.externalValueEstimate.evidenceId);
    if (evidence.externalValueEstimate.retrievedAt > evidence.acquiredAt) {
      return throwInvalidEvidence();
    }
  }

  if (new Set(evidenceIds).size !== evidenceIds.length) {
    return throwInvalidEvidence();
  }
}

function compareRecordedSales(
  left: MutablePriceDecisionEvidence["recordedSales"][number],
  right: MutablePriceDecisionEvidence["recordedSales"][number],
): number {
  return (
    right.saleDate.localeCompare(left.saleDate) ||
    left.distanceMiles - right.distanceMiles ||
    left.propertyId.localeCompare(right.propertyId)
  );
}

const listingEventOrder = Object.freeze({
  listed: 0,
  relisted: 1,
  "price-change": 2,
  removed: 3,
} as const);

function compareListingEvents(
  left: NonNullable<
    MutablePriceDecisionEvidence["targetListing"]
  >["events"][number],
  right: NonNullable<
    MutablePriceDecisionEvidence["targetListing"]
  >["events"][number],
): number {
  return (
    left.occurredOn.localeCompare(right.occurredOn) ||
    listingEventOrder[left.kind] - listingEventOrder[right.kind] ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

function requireCoordinatePair(
  value: { latitude: number | null; longitude: number | null },
  context: z.RefinementCtx,
): void {
  if ((value.latitude === null) !== (value.longitude === null)) {
    context.addIssue({
      code: "custom",
      message: "Latitude and longitude must be provided together",
    });
  }
}

function boundedText(maximumLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
}

function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
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

function throwInvalidEvidence(): never {
  throw new InvalidPriceDecisionEvidenceError();
}
