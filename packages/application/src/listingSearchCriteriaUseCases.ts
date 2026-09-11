import {
  listingSearchCriteriaSchemaVersion,
  listingSearchState,
  listingSearchStatus,
  normalizeListingSearchCriteria,
  type ListingPropertyType,
  type ListingSearchCity,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";

import {
  normalizeListingSearchProfile,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ListingSearchProfile,
  type ListingSearchProfileQueryPort,
  type ListingSearchProfileRepositoryPort,
} from "./listingSearchProfile.js";
import {
  createListingRefreshRequestPlan,
  normalizeListingRefreshRun,
  type CurrentListingInventory,
  type CurrentListingInventoryQueryPort,
  type HistoricalListingInventoryQueryPort,
  type ListingHistoryPage,
  type ListingHistoryQuery,
  type ListingRefreshDispatchPort,
  type ListingRefreshRun,
  type ListingRefreshRunRepositoryPort,
  type ListingSearchProfileRefreshRepositoryPort,
} from "./listingRefreshContracts.js";

export interface EditableListingSearchCriteria {
  readonly propertyType: ListingPropertyType;
  readonly minimumPrice: number;
  readonly maximumPrice: number;
  readonly minimumBedrooms: number;
  readonly minimumBathrooms: number;
  readonly cities: readonly ListingSearchCity[];
}

export interface ListingSearchCriteriaResult {
  readonly criteria: EditableListingSearchCriteria;
  readonly revision: number;
  readonly appliedRevision: number;
  readonly updatedAt: string;
}

export interface UpdateListingSearchCriteriaInput {
  readonly actorUserId: string;
  readonly expectedRevision: number;
  readonly criteria: EditableListingSearchCriteria;
}

export interface UpdateListingSearchCriteriaOptions {
  readonly repository: ListingSearchProfileRepositoryPort;
  readonly now: () => Date;
}

export type ListingRefreshDispatchStatus =
  | "not-required"
  | "dispatched"
  | "failed";

export interface UpdateListingSearchCriteriaAndQueueRefreshResult {
  readonly searchCriteria: ListingSearchCriteriaResult;
  readonly refreshRun: ListingRefreshRun | null;
  readonly refreshDispatch: ListingRefreshDispatchStatus;
}

export interface UpdateListingSearchCriteriaAndQueueRefreshOptions {
  readonly repository: ListingSearchProfileRefreshRepositoryPort;
  readonly runRepository: ListingRefreshRunRepositoryPort;
  readonly dispatcher: ListingRefreshDispatchPort;
  readonly createId: () => string;
  readonly now: () => Date;
}

export interface RetryLatestListingRefreshInput {
  readonly expectedRevision: number;
  readonly confirmedPlannedProviderRequestCount: number;
}

export interface RetryLatestListingRefreshResult {
  readonly refreshRun: ListingRefreshRun;
  readonly refreshDispatch: Exclude<
    ListingRefreshDispatchStatus,
    "not-required"
  >;
}

export interface RetryLatestListingRefreshOptions {
  readonly profileRepository: ListingSearchProfileQueryPort;
  readonly runRepository: ListingRefreshRunRepositoryPort;
  readonly dispatcher: ListingRefreshDispatchPort;
  readonly createId: () => string;
  readonly now: () => Date;
}

export class InvalidListingSearchCriteriaInputError extends Error {
  constructor() {
    super("Listing search criteria input was invalid");
    this.name = "InvalidListingSearchCriteriaInputError";
  }
}

export class ListingSearchCriteriaChangedError extends Error {
  constructor() {
    super("Listing search criteria changed");
    this.name = "ListingSearchCriteriaChangedError";
  }
}

export class ListingSearchProfileUnavailableError extends Error {
  constructor() {
    super("Listing search profile was unavailable");
    this.name = "ListingSearchProfileUnavailableError";
  }
}

export class InvalidListingSearchCriteriaResultError extends Error {
  constructor() {
    super("Listing search criteria result was invalid");
    this.name = "InvalidListingSearchCriteriaResultError";
  }
}

export class InvalidListingRefreshRetryInputError extends Error {
  constructor() {
    super("Listing refresh retry input was invalid");
    this.name = "InvalidListingRefreshRetryInputError";
  }
}

export class ListingRefreshRetryUnavailableError extends Error {
  constructor() {
    super("Listing refresh retry was unavailable");
    this.name = "ListingRefreshRetryUnavailableError";
  }
}

export class GetListingSearchCriteria {
  constructor(private readonly repository: ListingSearchProfileQueryPort) {}

  async execute(): Promise<ListingSearchCriteriaResult> {
    const profile = await this.repository.findPrimaryProfile();
    if (profile === null) {
      throw new ListingSearchProfileUnavailableError();
    }
    return projectCriteria(requireValidProfile(profile));
  }
}

export class UpdateListingSearchCriteria {
  constructor(private readonly options: UpdateListingSearchCriteriaOptions) {}

  async execute(
    input: UpdateListingSearchCriteriaInput,
  ): Promise<ListingSearchCriteriaResult> {
    const normalizedInput = normalizeUpdateInput(input);
    const updatedAt = readClock(this.options.now);
    const persistenceResult = await this.options.repository.savePrimaryProfile({
      criteria: normalizedInput.criteria,
      expectedRevision: normalizedInput.expectedRevision,
      updatedByUserId: normalizedInput.actorUserId,
      updatedAt,
    });

    if (persistenceResult.status === "conflict") {
      throw new ListingSearchCriteriaChangedError();
    }

    const profile = requireValidProfile(persistenceResult.profile);
    assertExpectedSaveResult(profile, {
      actorUserId: normalizedInput.actorUserId,
      criteria: normalizedInput.criteria,
      expectedRevision: normalizedInput.expectedRevision,
      status: persistenceResult.status,
      updatedAt,
    });
    return projectCriteria(profile);
  }
}

export class GetLatestListingRefreshStatus {
  constructor(private readonly repository: ListingRefreshRunRepositoryPort) {}

  async execute(): Promise<ListingRefreshRun | null> {
    const run = await this.repository.findLatestRun();
    return run === null ? null : requireValidRun(run);
  }
}

export class UpdateListingSearchCriteriaAndQueueRefresh {
  constructor(
    private readonly options: UpdateListingSearchCriteriaAndQueueRefreshOptions,
  ) {}

  async execute(
    input: UpdateListingSearchCriteriaInput,
  ): Promise<UpdateListingSearchCriteriaAndQueueRefreshResult> {
    const normalizedInput = normalizeUpdateInput(input);
    const requestedAt = readClock(this.options.now);
    const plan = createListingRefreshRequestPlan(normalizedInput.criteria);
    const runId = readCreatedId(this.options.createId);
    const persistenceResult =
      await this.options.repository.savePrimaryProfileAndQueueRefresh({
        criteria: normalizedInput.criteria,
        expectedRevision: normalizedInput.expectedRevision,
        updatedByUserId: normalizedInput.actorUserId,
        updatedAt: requestedAt,
        runId,
        plan,
      });

    if (persistenceResult.status === "conflict") {
      throw new ListingSearchCriteriaChangedError();
    }

    const profile = requireValidProfile(persistenceResult.profile);
    assertExpectedSaveResult(profile, {
      actorUserId: normalizedInput.actorUserId,
      criteria: normalizedInput.criteria,
      expectedRevision: normalizedInput.expectedRevision,
      status: persistenceResult.status,
      updatedAt: requestedAt,
    });

    if (persistenceResult.status === "unchanged") {
      const latest = await this.options.runRepository.findLatestRun();
      return Object.freeze({
        searchCriteria: projectCriteria(profile),
        refreshRun: latest === null ? null : requireValidRun(latest),
        refreshDispatch: "not-required" as const,
      });
    }

    const run = requireValidRun(persistenceResult.run);
    assertQueuedRun(run, {
      plan,
      requestedAt,
      revision: profile.revision,
      runId,
      triggerReason: "criteria-change",
    });
    const refreshDispatch = await dispatchRun(this.options.dispatcher, runId);
    return Object.freeze({
      searchCriteria: projectCriteria(profile),
      refreshRun: run,
      refreshDispatch,
    });
  }
}

export class RetryLatestListingRefresh {
  constructor(private readonly options: RetryLatestListingRefreshOptions) {}

  async execute(
    input: RetryLatestListingRefreshInput,
  ): Promise<RetryLatestListingRefreshResult> {
    const normalizedInput = normalizeRetryInput(input);
    const [profileValue, latestValue] = await Promise.all([
      this.options.profileRepository.findPrimaryProfile(),
      this.options.runRepository.findLatestRun(),
    ]);
    if (profileValue === null || latestValue === null) {
      throw new ListingRefreshRetryUnavailableError();
    }
    const profile = requireValidProfile(profileValue);
    const latest = requireValidRun(latestValue);
    const plan = createListingRefreshRequestPlan(profile.criteria);
    if (
      profile.revision !== normalizedInput.expectedRevision ||
      latest.requestedRevision !== profile.revision ||
      (latest.status !== "queued" &&
        latest.status !== "failed" &&
        latest.status !== "superseded") ||
      JSON.stringify(latest.selectedMarkets) !==
        JSON.stringify(plan.selectedMarkets) ||
      latest.selectedMarketCount !== plan.selectedMarketCount ||
      latest.plannedProviderRequestCount !==
        plan.plannedProviderRequestCount ||
      normalizedInput.confirmedPlannedProviderRequestCount !==
        plan.plannedProviderRequestCount
    ) {
      throw new ListingRefreshRetryUnavailableError();
    }

    if (latest.status === "queued") {
      return Object.freeze({
        refreshRun: latest,
        refreshDispatch: await dispatchRun(
          this.options.dispatcher,
          latest.runId,
        ),
      });
    }

    const requestedAt = readClock(this.options.now);
    const runId = readCreatedId(this.options.createId);
    const run = requireValidRun(
      await this.options.runRepository.queueRun({
        runId,
        profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        revision: profile.revision,
        triggerReason: "manual-retry",
        requestedAt,
        plan,
      }),
    );
    assertQueuedRun(run, {
      plan,
      requestedAt,
      revision: profile.revision,
      runId,
      triggerReason: "manual-retry",
    });
    return Object.freeze({
      refreshRun: run,
      refreshDispatch: await dispatchRun(this.options.dispatcher, runId),
    });
  }
}

export class GetCurrentListingInventory {
  constructor(private readonly query: CurrentListingInventoryQueryPort) {}

  execute(): Promise<CurrentListingInventory | null> {
    return this.query.findCurrentInventory();
  }
}

export class ListHistoricalListingInventory {
  constructor(private readonly query: HistoricalListingInventoryQueryPort) {}

  execute(query: ListingHistoryQuery): Promise<ListingHistoryPage> {
    return this.query.findListingHistory(query);
  }
}

const updateInputKeys = new Set([
  "actorUserId",
  "expectedRevision",
  "criteria",
]);
const editableCriteriaKeys = new Set([
  "propertyType",
  "minimumPrice",
  "maximumPrice",
  "minimumBedrooms",
  "minimumBathrooms",
  "cities",
]);

function normalizeUpdateInput(input: unknown): {
  actorUserId: string;
  expectedRevision: number;
  criteria: ListingSearchCriteriaV1;
} {
  if (
    !isExactRecord(input, updateInputKeys) ||
    !isUuid(input.actorUserId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    typeof input.expectedRevision !== "number" ||
    input.expectedRevision < 1 ||
    !isExactRecord(input.criteria, editableCriteriaKeys)
  ) {
    throw new InvalidListingSearchCriteriaInputError();
  }

  let criteria: ListingSearchCriteriaV1;
  try {
    criteria = normalizeListingSearchCriteria({
      schemaVersion: listingSearchCriteriaSchemaVersion,
      state: listingSearchState,
      status: listingSearchStatus,
      propertyType: input.criteria.propertyType,
      minimumPrice: input.criteria.minimumPrice,
      maximumPrice: input.criteria.maximumPrice,
      minimumBedrooms: input.criteria.minimumBedrooms,
      minimumBathrooms: input.criteria.minimumBathrooms,
      cities: input.criteria.cities,
    });
  } catch {
    throw new InvalidListingSearchCriteriaInputError();
  }

  return Object.freeze({
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    criteria,
  });
}

function requireValidProfile(value: unknown): ListingSearchProfile {
  try {
    return normalizeListingSearchProfile(value);
  } catch {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

function assertExpectedSaveResult(
  profile: ListingSearchProfile,
  expected: {
    actorUserId: string;
    criteria: ListingSearchCriteriaV1;
    expectedRevision: number;
    status: "updated" | "unchanged";
    updatedAt: string;
  },
): void {
  if (!criteriaAreEqual(profile.criteria, expected.criteria)) {
    throw new InvalidListingSearchCriteriaResultError();
  }

  if (expected.status === "unchanged") {
    if (profile.revision !== expected.expectedRevision) {
      throw new InvalidListingSearchCriteriaResultError();
    }
    return;
  }

  if (
    profile.revision !== expected.expectedRevision + 1 ||
    profile.appliedRevision > expected.expectedRevision ||
    profile.updatedByUserId !== expected.actorUserId ||
    profile.updatedAt !== expected.updatedAt
  ) {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

function projectCriteria(
  profile: ListingSearchProfile,
): ListingSearchCriteriaResult {
  return Object.freeze({
    criteria: Object.freeze({
      propertyType: profile.criteria.propertyType,
      minimumPrice: profile.criteria.minimumPrice,
      maximumPrice: profile.criteria.maximumPrice,
      minimumBedrooms: profile.criteria.minimumBedrooms,
      minimumBathrooms: profile.criteria.minimumBathrooms,
      cities: Object.freeze([...profile.criteria.cities]),
    }),
    revision: profile.revision,
    appliedRevision: profile.appliedRevision,
    updatedAt: profile.updatedAt,
  });
}

function normalizeRetryInput(
  input: unknown,
): RetryLatestListingRefreshInput {
  const keys = new Set([
    "expectedRevision",
    "confirmedPlannedProviderRequestCount",
  ]);
  if (
    !isExactRecord(input, keys) ||
    !isPositiveSafeInteger(input.expectedRevision) ||
    !isPositiveSafeInteger(input.confirmedPlannedProviderRequestCount)
  ) {
    throw new InvalidListingRefreshRetryInputError();
  }
  return Object.freeze({
    expectedRevision: input.expectedRevision,
    confirmedPlannedProviderRequestCount:
      input.confirmedPlannedProviderRequestCount,
  });
}

function requireValidRun(value: unknown): ListingRefreshRun {
  try {
    return normalizeListingRefreshRun(value);
  } catch {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

function assertQueuedRun(
  run: ListingRefreshRun,
  expected: {
    readonly runId: string;
    readonly revision: number;
    readonly requestedAt: string;
    readonly triggerReason: "criteria-change" | "manual-retry";
    readonly plan: ReturnType<typeof createListingRefreshRequestPlan>;
  },
): void {
  if (
    run.runId !== expected.runId ||
    run.profileKey !== PRIMARY_LISTING_SEARCH_PROFILE_KEY ||
    run.requestedRevision !== expected.revision ||
    run.triggerReason !== expected.triggerReason ||
    run.status !== "queued" ||
    run.requestedAt !== expected.requestedAt ||
    JSON.stringify(run.selectedMarkets) !==
      JSON.stringify(expected.plan.selectedMarkets) ||
    run.selectedMarketCount !== expected.plan.selectedMarketCount ||
    run.plannedProviderRequestCount !==
      expected.plan.plannedProviderRequestCount
  ) {
    throw new InvalidListingSearchCriteriaResultError();
  }
}

async function dispatchRun(
  dispatcher: ListingRefreshDispatchPort,
  runId: string,
): Promise<"dispatched" | "failed"> {
  try {
    await dispatcher.dispatch(runId);
    return "dispatched";
  } catch {
    return "failed";
  }
}

function readCreatedId(createId: () => string): string {
  const value = createId();
  if (!isUuid(value)) {
    throw new Error("Listing refresh ID factory returned an invalid ID");
  }
  return value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function criteriaAreEqual(
  left: ListingSearchCriteriaV1,
  right: ListingSearchCriteriaV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Listing search criteria clock was invalid");
  }
  return value.toISOString();
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
