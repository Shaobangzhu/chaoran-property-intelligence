import { z } from "zod";

import {
  listingMembershipLifecycleStates,
  listingSearchCities,
  normalizeListingSearchCriteria,
  type ListingMembershipLifecycleState,
  type ListingSearchCity,
  type ListingSearchCriteriaV1,
  type NormalizedListing,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import type {
  ListingAlertEvent,
  ListingPriceObservation,
} from "./listingAlertContracts.js";
import {
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ListingSearchProfile,
  type SaveListingSearchProfileInput,
} from "./listingSearchProfile.js";

export const LISTING_REFRESH_LIMITS = Object.freeze({
  maximumProviderRequests: listingSearchCities.length,
  maximumListingsPerMarket: 500,
  maximumListingCount: listingSearchCities.length * 500,
  maximumFailureCodeLength: 80,
  maximumHistoryPageSize: 100,
  maximumHistoryCursorLength: 512,
});

export const listingRefreshTriggerReasons = Object.freeze([
  "criteria-change",
  "scheduled",
  "manual-retry",
] as const);
export const listingRefreshRunStatuses = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
] as const);

export const listingRefreshTriggerReasonSchema = z.enum(
  listingRefreshTriggerReasons,
);
export const listingRefreshRunStatusSchema = z.enum(listingRefreshRunStatuses);

const uuidSchema = z.uuid();
const canonicalTimestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isCanonicalTimestamp);
const positiveRevisionSchema = z.number().int().positive().safe();
const boundedCountSchema = z.number().int().nonnegative().safe();
const providerRequestCountSchema = boundedCountSchema.max(
  LISTING_REFRESH_LIMITS.maximumProviderRequests,
);
const listingCountSchema = boundedCountSchema.max(
  LISTING_REFRESH_LIMITS.maximumListingCount,
);
const failureCodeSchema = z
  .string()
  .min(1)
  .max(LISTING_REFRESH_LIMITS.maximumFailureCodeLength)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const selectedMarketsSchema = z
  .array(z.enum(listingSearchCities))
  .min(1)
  .max(listingSearchCities.length)
  .refine((markets) => new Set(markets).size === markets.length)
  .refine((markets) =>
    markets.every(
      (market, index) =>
        listingSearchCities.indexOf(market) >= indexOfPrevious(markets, index),
    ),
  );

export const listingRefreshRequestPlanSchema = z
  .strictObject({
    selectedMarkets: selectedMarketsSchema,
    selectedMarketCount: providerRequestCountSchema,
    plannedProviderRequestCount: providerRequestCountSchema,
  })
  .superRefine((plan, context) => {
    if (
      plan.selectedMarketCount !== plan.selectedMarkets.length ||
      plan.plannedProviderRequestCount !== plan.selectedMarkets.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Each selected market requires exactly one provider request",
        path: ["plannedProviderRequestCount"],
      });
    }
  });

export const listingRefreshRunSchema = z
  .strictObject({
    runId: uuidSchema,
    profileKey: z.literal(PRIMARY_LISTING_SEARCH_PROFILE_KEY),
    requestedRevision: positiveRevisionSchema,
    effectiveRevision: positiveRevisionSchema.nullable(),
    triggerReason: listingRefreshTriggerReasonSchema,
    status: listingRefreshRunStatusSchema,
    requestedAt: canonicalTimestampSchema,
    startedAt: canonicalTimestampSchema.nullable(),
    completedAt: canonicalTimestampSchema.nullable(),
    selectedMarkets: selectedMarketsSchema,
    selectedMarketCount: providerRequestCountSchema,
    plannedProviderRequestCount: providerRequestCountSchema,
    actualProviderRequestCount: providerRequestCountSchema,
    returnedListingCount: listingCountSchema,
    publishedCurrentCount: listingCountSchema,
    failureCode: failureCodeSchema.nullable(),
    supersededByRunId: uuidSchema.nullable(),
  })
  .superRefine(assertRunRelationships);

export const listingSearchMembershipSchema = z
  .strictObject({
    profileKey: z.literal(PRIMARY_LISTING_SEARCH_PROFILE_KEY),
    listingId: uuidSchema,
    appliedRevision: positiveRevisionSchema,
    lastSuccessfulRunId: uuidSchema,
    lifecycleState: z.enum(listingMembershipLifecycleStates),
    firstMatchedAt: canonicalTimestampSchema,
    lastMatchedAt: canonicalTimestampSchema,
    lastServerObservedAt: canonicalTimestampSchema,
    consecutiveCompleteRunAbsenceCount: boundedCountSchema,
    inactiveAt: canonicalTimestampSchema.nullable(),
    explicitProviderStatus: z.literal("sold").nullable(),
    explicitProviderStatusObservedAt: canonicalTimestampSchema.nullable(),
  })
  .superRefine(assertMembershipRelationships);

const claimedRunResultSchema = z.strictObject({
  status: z.literal("claimed"),
  claim: z.strictObject({
    claimToken: uuidSchema,
    run: listingRefreshRunSchema,
    criteria: z.unknown(),
    appliedRevision: positiveRevisionSchema,
  }),
});
export const claimLatestListingRefreshRunResultSchema = z.discriminatedUnion(
  "status",
  [
    claimedRunResultSchema,
    z.strictObject({ status: z.literal("no-queued-run") }),
    z.strictObject({ status: z.literal("already-running") }),
  ],
);

const completedRunResultSchema = z.strictObject({
  status: z.enum(["completed", "already-completed"]),
  run: listingRefreshRunSchema,
});
export const completeListingRefreshRunResultSchema = z.discriminatedUnion(
  "status",
  [
    completedRunResultSchema,
    z.strictObject({ status: z.literal("stale-claim") }),
    z.strictObject({ status: z.literal("criteria-revision-conflict") }),
  ],
);

type MutableListingRefreshRequestPlan = z.infer<
  typeof listingRefreshRequestPlanSchema
>;
type MutableListingRefreshRun = z.infer<typeof listingRefreshRunSchema>;
type MutableListingSearchMembership = z.infer<
  typeof listingSearchMembershipSchema
>;

export type ListingRefreshTriggerReason = z.infer<
  typeof listingRefreshTriggerReasonSchema
>;
export type ListingRefreshRunStatus = z.infer<
  typeof listingRefreshRunStatusSchema
>;
export type ListingRefreshRequestPlan = DeepReadonly<
  MutableListingRefreshRequestPlan
>;
export type ListingRefreshRun = DeepReadonly<MutableListingRefreshRun>;
export type ListingSearchMembership = DeepReadonly<
  MutableListingSearchMembership
>;

export interface ListingRefreshRunClaim {
  readonly claimToken: string;
  readonly run: ListingRefreshRun;
  readonly criteria: ListingSearchCriteriaV1;
  readonly appliedRevision: number;
}

export interface ClaimLatestListingRefreshRunInput {
  readonly profileKey: typeof PRIMARY_LISTING_SEARCH_PROFILE_KEY;
  readonly signaledRunId: string | null;
  readonly claimToken: string;
  readonly claimedAt: string;
}

export type ClaimLatestListingRefreshRunResult =
  | { readonly status: "claimed"; readonly claim: ListingRefreshRunClaim }
  | { readonly status: "no-queued-run" }
  | { readonly status: "already-running" };

export interface ListingRefreshPublicationCandidate {
  readonly listing: DeepReadonly<RentCastNormalizedListing>;
  readonly observation: DeepReadonly<ListingPriceObservation>;
  readonly event: DeepReadonly<ListingAlertEvent> | null;
  readonly acquisitionEligible: true;
  readonly currentDisplayEligible: boolean;
}

interface CompleteListingRefreshRunBaseInput {
  readonly runId: string;
  readonly claimToken: string;
  readonly expectedEffectiveRevision: number;
  readonly completedAt: string;
  readonly actualProviderRequestCount: number;
  readonly returnedListingCount: number;
}

export interface SucceedListingRefreshRunInput
  extends CompleteListingRefreshRunBaseInput {
  readonly outcome: "succeeded";
  readonly candidates: readonly ListingRefreshPublicationCandidate[];
  readonly publishedCurrentCount: number;
}

export interface FailListingRefreshRunInput
  extends CompleteListingRefreshRunBaseInput {
  readonly outcome: "failed";
  readonly failureCode: string;
}

export type CompleteListingRefreshRunInput =
  | SucceedListingRefreshRunInput
  | FailListingRefreshRunInput;

export type CompleteListingRefreshRunResult =
  | { readonly status: "completed"; readonly run: ListingRefreshRun }
  | { readonly status: "already-completed"; readonly run: ListingRefreshRun }
  | { readonly status: "stale-claim" }
  | { readonly status: "criteria-revision-conflict" };

export interface QueueListingRefreshInput {
  readonly runId: string;
  readonly profileKey: typeof PRIMARY_LISTING_SEARCH_PROFILE_KEY;
  readonly revision: number;
  readonly triggerReason: ListingRefreshTriggerReason;
  readonly requestedAt: string;
  readonly plan: ListingRefreshRequestPlan;
}

export interface SaveListingSearchProfileAndQueueRefreshInput
  extends SaveListingSearchProfileInput {
  readonly runId: string;
  readonly plan: ListingRefreshRequestPlan;
}

export type SaveListingSearchProfileAndQueueRefreshResult =
  | {
      readonly status: "updated";
      readonly profile: ListingSearchProfile;
      readonly run: ListingRefreshRun;
    }
  | {
      readonly status: "unchanged";
      readonly profile: ListingSearchProfile;
    }
  | { readonly status: "conflict" };

export interface ListingRefreshRunRepositoryPort {
  claimLatestRun(
    input: ClaimLatestListingRefreshRunInput,
  ): Promise<ClaimLatestListingRefreshRunResult>;
  completeRun(
    input: CompleteListingRefreshRunInput,
  ): Promise<CompleteListingRefreshRunResult>;
  findLatestRun(): Promise<ListingRefreshRun | null>;
  queueRun(input: QueueListingRefreshInput): Promise<ListingRefreshRun>;
}

export interface ListingSearchProfileRefreshRepositoryPort {
  savePrimaryProfileAndQueueRefresh(
    input: SaveListingSearchProfileAndQueueRefreshInput,
  ): Promise<SaveListingSearchProfileAndQueueRefreshResult>;
}

export interface ListingRefreshDispatchPort {
  dispatch(runId: string): Promise<void>;
}

export interface ListingInventoryItem {
  readonly listingId: string;
  readonly listing: DeepReadonly<NormalizedListing>;
  readonly membership: ListingSearchMembership;
  readonly acquisitionEligible: boolean;
  readonly currentDisplayEligible: boolean;
}

export interface CurrentListingInventory {
  readonly profileKey: typeof PRIMARY_LISTING_SEARCH_PROFILE_KEY;
  readonly appliedRevision: number;
  readonly refreshedAt: string;
  readonly items: readonly ListingInventoryItem[];
}

export interface ListingHistoryQuery {
  readonly lifecycleStates: readonly ListingMembershipLifecycleState[];
  readonly cursor: string | null;
  readonly limit: number;
}

export interface ListingHistoryPage {
  readonly items: readonly ListingInventoryItem[];
  readonly nextCursor: string | null;
}

export interface CurrentListingInventoryQueryPort {
  findCurrentInventory(): Promise<CurrentListingInventory | null>;
}

export interface HistoricalListingInventoryQueryPort {
  findListingHistory(query: ListingHistoryQuery): Promise<ListingHistoryPage>;
}

export class InvalidListingRefreshContractError extends Error {
  constructor() {
    super("Listing refresh contract was invalid");
    this.name = "InvalidListingRefreshContractError";
  }
}

export function normalizeListingRefreshRequestPlan(
  value: unknown,
): ListingRefreshRequestPlan {
  return parseAndFreeze(listingRefreshRequestPlanSchema, value);
}

export function createListingRefreshRequestPlan(
  criteria: ListingSearchCriteriaV1,
): ListingRefreshRequestPlan {
  const normalizedCriteria = normalizeListingSearchCriteria(criteria);
  const selectedMarkets = [...normalizedCriteria.cities];
  return normalizeListingRefreshRequestPlan({
    selectedMarkets,
    selectedMarketCount: selectedMarkets.length,
    plannedProviderRequestCount: selectedMarkets.length,
  });
}

export function normalizeListingRefreshRun(value: unknown): ListingRefreshRun {
  return parseAndFreeze(listingRefreshRunSchema, value);
}

export function normalizeListingSearchMembership(
  value: unknown,
): ListingSearchMembership {
  return parseAndFreeze(listingSearchMembershipSchema, value);
}

export function normalizeClaimLatestListingRefreshRunResult(
  value: unknown,
): ClaimLatestListingRefreshRunResult {
  const result = claimLatestListingRefreshRunResultSchema.safeParse(value);
  if (!result.success) {
    return throwInvalidContract();
  }
  if (result.data.status !== "claimed") {
    return deepFreeze(result.data);
  }
  if (result.data.claim.run.status !== "running") {
    return throwInvalidContract();
  }
  if (
    result.data.claim.run.effectiveRevision === null ||
    result.data.claim.appliedRevision >
      result.data.claim.run.effectiveRevision
  ) {
    return throwInvalidContract();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria(result.data.claim.criteria);
  } catch {
    return throwInvalidContract();
  }
  return deepFreeze({
    status: "claimed" as const,
    claim: {
      claimToken: result.data.claim.claimToken,
      run: result.data.claim.run,
      criteria,
      appliedRevision: result.data.claim.appliedRevision,
    },
  });
}

export function normalizeCompleteListingRefreshRunResult(
  value: unknown,
): CompleteListingRefreshRunResult {
  const result = completeListingRefreshRunResultSchema.safeParse(value);
  if (!result.success) {
    return throwInvalidContract();
  }
  if (
    (result.data.status === "completed" ||
      result.data.status === "already-completed") &&
    result.data.run.status !== "succeeded" &&
    result.data.run.status !== "failed"
  ) {
    return throwInvalidContract();
  }
  return deepFreeze(result.data);
}

function assertRunRelationships(
  run: z.infer<typeof listingRefreshRunSchema>,
  context: z.RefinementCtx,
): void {
  const timestampsOrdered =
    (run.startedAt === null || run.startedAt >= run.requestedAt) &&
    (run.completedAt === null ||
      (run.startedAt === null
        ? run.completedAt >= run.requestedAt
        : run.completedAt >= run.startedAt));
  if (!timestampsOrdered) {
    addContractIssue(context, "Run timestamps were out of order", [
      "completedAt",
    ]);
  }
  if (
    run.selectedMarketCount !== run.selectedMarkets.length ||
    run.plannedProviderRequestCount !== run.selectedMarkets.length ||
    run.actualProviderRequestCount > run.plannedProviderRequestCount ||
    run.publishedCurrentCount > run.returnedListingCount
  ) {
    addContractIssue(context, "Run counts were inconsistent", [
      "actualProviderRequestCount",
    ]);
  }

  const hasZeroResultCounts =
    run.actualProviderRequestCount === 0 &&
    run.returnedListingCount === 0 &&
    run.publishedCurrentCount === 0;
  switch (run.status) {
    case "queued":
      if (
        run.effectiveRevision !== null ||
        run.startedAt !== null ||
        run.completedAt !== null ||
        run.failureCode !== null ||
        run.supersededByRunId !== null ||
        !hasZeroResultCounts
      ) {
        addContractIssue(context, "Queued run state was inconsistent");
      }
      break;
    case "running":
      if (
        run.effectiveRevision === null ||
        run.startedAt === null ||
        run.completedAt !== null ||
        run.failureCode !== null ||
        run.supersededByRunId !== null ||
        run.publishedCurrentCount !== 0
      ) {
        addContractIssue(context, "Running run state was inconsistent");
      }
      break;
    case "succeeded":
      if (
        run.effectiveRevision === null ||
        run.startedAt === null ||
        run.completedAt === null ||
        run.failureCode !== null ||
        run.supersededByRunId !== null ||
        run.actualProviderRequestCount !== run.plannedProviderRequestCount
      ) {
        addContractIssue(context, "Succeeded run state was inconsistent");
      }
      break;
    case "failed":
      if (
        run.completedAt === null ||
        run.failureCode === null ||
        run.supersededByRunId !== null ||
        run.publishedCurrentCount !== 0 ||
        (run.startedAt === null) !== (run.effectiveRevision === null) ||
        (run.startedAt === null && !hasZeroResultCounts)
      ) {
        addContractIssue(context, "Failed run state was inconsistent");
      }
      break;
    case "superseded":
      if (
        run.effectiveRevision !== null ||
        run.startedAt !== null ||
        run.completedAt === null ||
        run.failureCode !== null ||
        run.supersededByRunId === null ||
        run.supersededByRunId === run.runId ||
        !hasZeroResultCounts
      ) {
        addContractIssue(context, "Superseded run state was inconsistent");
      }
      break;
  }
}

function assertMembershipRelationships(
  membership: z.infer<typeof listingSearchMembershipSchema>,
  context: z.RefinementCtx,
): void {
  if (
    membership.lastMatchedAt < membership.firstMatchedAt ||
    membership.lastServerObservedAt < membership.lastMatchedAt
  ) {
    addContractIssue(context, "Membership timestamps were out of order", [
      "lastServerObservedAt",
    ]);
  }

  const absenceCount = membership.consecutiveCompleteRunAbsenceCount;
  switch (membership.lifecycleState) {
    case "current":
    case "out_of_scope":
      if (
        absenceCount !== 0 ||
        membership.inactiveAt !== null ||
        membership.explicitProviderStatus !== null ||
        membership.explicitProviderStatusObservedAt !== null
      ) {
        addContractIssue(context, "Active membership state was inconsistent");
      }
      break;
    case "missing":
      if (
        absenceCount < 1 ||
        membership.inactiveAt !== null ||
        membership.explicitProviderStatus !== null ||
        membership.explicitProviderStatusObservedAt !== null
      ) {
        addContractIssue(context, "Missing membership state was inconsistent");
      }
      break;
    case "inactive":
      if (
        absenceCount < 2 ||
        membership.inactiveAt === null ||
        membership.inactiveAt < membership.lastServerObservedAt ||
        membership.explicitProviderStatus !== null ||
        membership.explicitProviderStatusObservedAt !== null
      ) {
        addContractIssue(context, "Inactive membership state was inconsistent");
      }
      break;
    case "sold":
      if (
        membership.inactiveAt !== null ||
        membership.explicitProviderStatus !== "sold" ||
        membership.explicitProviderStatusObservedAt !==
          membership.lastServerObservedAt
      ) {
        addContractIssue(context, "Sold membership state was inconsistent");
      }
      break;
  }
}

function indexOfPrevious(
  markets: readonly ListingSearchCity[],
  index: number,
): number {
  if (index === 0) {
    return -1;
  }
  const previous = markets[index - 1];
  return previous === undefined ? -1 : listingSearchCities.indexOf(previous);
}

function addContractIssue(
  context: z.RefinementCtx,
  message: string,
  path: PropertyKey[] = [],
): void {
  context.addIssue({ code: "custom", message, path });
}

function parseAndFreeze<T>(schema: z.ZodType<T>, value: unknown): DeepReadonly<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    return throwInvalidContract();
  }
  return deepFreeze(result.data);
}

function throwInvalidContract(): never {
  throw new InvalidListingRefreshContractError();
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

type DeepReadonly<T> = T extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? T
  : T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
