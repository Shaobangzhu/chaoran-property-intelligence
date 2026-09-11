import { z } from "zod";

export const LISTING_RETENTION_DEFAULTS = Object.freeze({
  runDetailDays: 90,
  inactiveMembershipDays: 90,
  outOfScopeMembershipDays: 90,
  unreferencedProviderListingDays: 180,
  alertEventDays: 365,
  batchSize: 500,
});

export const listingRetentionRecordKinds = Object.freeze([
  "search-run",
  "search-membership",
  "provider-listing",
  "alert-event",
] as const);

const retentionDaysSchema = z.number().int().positive().max(3_650);
const boundedCountSchema = z.number().int().nonnegative().safe();
const canonicalTimestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isCanonicalTimestamp);
const aggregateCountsSchema = z.strictObject({
  searchRuns: boundedCountSchema,
  searchMemberships: boundedCountSchema,
  providerListings: boundedCountSchema,
  alertEvents: boundedCountSchema,
  total: boundedCountSchema,
});

export const listingRetentionPolicySchema = z.strictObject({
  runDetailDays: retentionDaysSchema,
  inactiveMembershipDays: retentionDaysSchema,
  outOfScopeMembershipDays: retentionDaysSchema,
  unreferencedProviderListingDays: retentionDaysSchema,
  alertEventDays: retentionDaysSchema,
  batchSize: z.number().int().positive().max(1_000),
});

export const listingRetentionCandidateSchema = z.strictObject({
  recordKind: z.enum(listingRetentionRecordKinds),
  recordKey: z.string().min(1).max(1_024).regex(/\S/),
  retainedThrough: canonicalTimestampSchema,
});

export const listingRetentionReportSchema = z
  .strictObject({
    mode: z.enum(["preview", "execute"]),
    asOf: canonicalTimestampSchema,
    startedAt: canonicalTimestampSchema,
    completedAt: canonicalTimestampSchema,
    candidates: aggregateCountsSchema,
    deleted: aggregateCountsSchema,
    hasMore: z.boolean(),
  })
  .superRefine((report, context) => {
    if (
      report.asOf > report.startedAt ||
      report.startedAt > report.completedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Retention report timestamps were out of order",
        path: ["completedAt"],
      });
    }
    assertAggregateTotal(report.candidates, context, ["candidates", "total"]);
    assertAggregateTotal(report.deleted, context, ["deleted", "total"]);
    if (report.mode === "preview" && report.deleted.total !== 0) {
      context.addIssue({
        code: "custom",
        message: "A retention preview cannot report deletions",
        path: ["deleted", "total"],
      });
    }
    if (
      report.deleted.searchRuns > report.candidates.searchRuns ||
      report.deleted.searchMemberships > report.candidates.searchMemberships ||
      report.deleted.providerListings > report.candidates.providerListings ||
      report.deleted.alertEvents > report.candidates.alertEvents
    ) {
      context.addIssue({
        code: "custom",
        message: "Retention deletions cannot exceed candidates",
        path: ["deleted"],
      });
    }
  });

type MutableListingRetentionPolicy = z.infer<
  typeof listingRetentionPolicySchema
>;
type MutableListingRetentionCandidate = z.infer<
  typeof listingRetentionCandidateSchema
>;
type MutableListingRetentionReport = z.infer<
  typeof listingRetentionReportSchema
>;

export type ListingRetentionRecordKind =
  (typeof listingRetentionRecordKinds)[number];
export type ListingRetentionPolicy = DeepReadonly<
  MutableListingRetentionPolicy
>;
export type ListingRetentionCandidate = DeepReadonly<
  MutableListingRetentionCandidate
>;
export type ListingRetentionAggregateCounts = ListingRetentionReport["candidates"];
export type ListingRetentionReport = DeepReadonly<
  MutableListingRetentionReport
>;

export interface InspectListingRetentionInput {
  readonly asOf: string;
  readonly policy: ListingRetentionPolicy;
}

export interface ExecuteListingRetentionInput
  extends InspectListingRetentionInput {
  readonly expectedCandidates: ListingRetentionAggregateCounts;
}

export interface ListingRetentionRepositoryPort {
  listCandidates(
    input: InspectListingRetentionInput,
  ): Promise<readonly ListingRetentionCandidate[]>;
  execute(
    input: ExecuteListingRetentionInput,
  ): Promise<ListingRetentionReport>;
}

export class InvalidListingRetentionContractError extends Error {
  constructor() {
    super("Listing retention contract was invalid");
    this.name = "InvalidListingRetentionContractError";
  }
}

export function normalizeListingRetentionPolicy(
  value: unknown,
): ListingRetentionPolicy {
  return parseAndFreeze(listingRetentionPolicySchema, value);
}

export function normalizeListingRetentionCandidate(
  value: unknown,
): ListingRetentionCandidate {
  return parseAndFreeze(listingRetentionCandidateSchema, value);
}

export function normalizeListingRetentionReport(
  value: unknown,
): ListingRetentionReport {
  return parseAndFreeze(listingRetentionReportSchema, value);
}

function assertAggregateTotal(
  counts: z.infer<typeof aggregateCountsSchema>,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (
    counts.total !==
    counts.searchRuns +
      counts.searchMemberships +
      counts.providerListings +
      counts.alertEvents
  ) {
    context.addIssue({
      code: "custom",
      message: "Retention aggregate total was inconsistent",
      path,
    });
  }
}

function parseAndFreeze<T>(schema: z.ZodType<T>, value: unknown): DeepReadonly<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvalidListingRetentionContractError();
  }
  return deepFreeze(result.data);
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
