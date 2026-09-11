import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import type {
  ListingAlertEvent,
  ListingAlertNotificationPort,
  ListingAlertStateRepositoryPort,
  ListingAlertTransition,
  ListingPriceObservation,
} from "./listingAlertContracts.js";
import type {
  ClaimLatestListingRefreshRunInput,
  ClaimLatestListingRefreshRunResult,
  CompleteListingRefreshRunInput,
  CompleteListingRefreshRunResult,
  ListingRefreshRun,
  ListingRefreshRunRepositoryPort,
  QueueListingRefreshInput,
} from "./listingRefreshContracts.js";
import type { ListingSearchProfile } from "./listingSearchProfile.js";
import {
  ListingRefreshExecutionError,
  ReconcileListingRefresh,
  type ListingRefreshSourceFactoryPort,
} from "./reconcileListingRefresh.js";

const runId = "0198c7d2-7668-7775-b0fc-b789690a6011";
const claimToken = "0198c7d2-7668-7775-b0fc-b789690a6012";
const scheduledRunId = "0198c7d2-7668-7775-b0fc-b789690a6013";
const requestedAt = "2026-09-10T15:00:00.000Z";
const completedAt = "2026-09-10T15:05:00.000Z";

describe("ReconcileListingRefresh", () => {
  it("publishes a complete changed-revision inventory as a quiet baseline", async () => {
    const runRepository = new FakeRunRepository([
      claimedResult(createRun({ requestedRevision: 2, effectiveRevision: 2 }), 1),
    ]);
    const alerts = new FakeAlertRepository();
    const sourceFactory = sourceReturning([createListing()], 1);

    const result = await createUseCase({
      alerts,
      runRepository,
      sourceFactory,
    }).execute({ signaledRunId: runId });

    expect(result).toEqual({
      status: "succeeded",
      runId,
      actualProviderRequestCount: 1,
      returnedListingCount: 1,
      publishedCurrentCount: 1,
    });
    expect(runRepository.completions).toHaveLength(1);
    expect(runRepository.completions[0]).toMatchObject({
      outcome: "succeeded",
      actualProviderRequestCount: 1,
      returnedListingCount: 1,
      publishedCurrentCount: 1,
      candidates: [
        {
          event: null,
          acquisitionEligible: true,
          currentDisplayEligible: true,
        },
      ],
    });
    expect(sourceFactory.createCalls).toHaveLength(1);
  });

  it("creates one scheduled run when an unsignaled invocation has no queue", async () => {
    const scheduledRun = createRun({
      runId: scheduledRunId,
      triggerReason: "scheduled",
    });
    const runRepository = new FakeRunRepository([
      { status: "no-queued-run" },
      claimedResult(scheduledRun, 1),
    ]);

    await createUseCase({
      runRepository,
      sourceFactory: sourceReturning([], 1),
    }).execute({ signaledRunId: null });

    expect(runRepository.queued).toEqual([
      expect.objectContaining({
        runId: scheduledRunId,
        revision: 1,
        triggerReason: "scheduled",
        plan: expect.objectContaining({
          plannedProviderRequestCount: 1,
          selectedMarkets: ["Corona"],
        }),
      }),
    ]);
  });

  it("creates normal alert transitions on same-revision reconciliation", async () => {
    const runRepository = new FakeRunRepository([
      claimedResult(createRun({ triggerReason: "scheduled" }), 1),
    ]);
    const alerts = new FakeAlertRepository();

    await createUseCase({
      alerts,
      runRepository,
      sourceFactory: sourceReturning([createListing()], 1),
    }).execute({ signaledRunId: null });

    const completion = runRepository.completions[0];
    expect(completion).toMatchObject({
      outcome: "succeeded",
      candidates: [{ event: { kind: "new-listing", status: "pending" } }],
    });
  });

  it("quietly establishes the first price-observation baseline", async () => {
    const runRepository = new FakeRunRepository([
      claimedResult(createRun({ triggerReason: "scheduled" }), 1),
    ]);
    const alerts = new FakeAlertRepository();
    alerts.baselineInitialized = false;

    await createUseCase({
      alerts,
      runRepository,
      sourceFactory: sourceReturning([createListing()], 1),
    }).execute({ signaledRunId: null });

    expect(runRepository.completions[0]).toMatchObject({
      outcome: "succeeded",
      candidates: [{ event: null, currentDisplayEligible: true }],
    });
    expect(alerts.baselineInitialized).toBe(true);
    expect(alerts.baselineInitializations).toBe(1);
  });

  it("records bounded partial request accounting and publishes nothing on failure", async () => {
    const runRepository = new FakeRunRepository([
      claimedResult(createRun(), 1),
    ]);
    const sourceFactory: RecordingSourceFactory = {
      createCalls: [],
      create(input) {
        this.createCalls.push(input);
        return {
          async getActiveSaleListings() {
            input.onProviderRequest();
            throw new Error("secret provider response");
          },
        };
      },
    };

    await expect(
      createUseCase({ runRepository, sourceFactory }).execute({
        signaledRunId: runId,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ListingRefreshExecutionError",
        failureCode: "refresh-execution-failed",
      }),
    );
    expect(runRepository.completions).toEqual([
      expect.objectContaining({
        outcome: "failed",
        actualProviderRequestCount: 1,
        returnedListingCount: 0,
        failureCode: "refresh-execution-failed",
      }),
    ]);
    expect(JSON.stringify(runRepository.completions)).not.toContain("secret");
  });

  it("rejects a mismatched request plan before constructing a provider source", async () => {
    const mismatched = createRun({
      selectedMarkets: ["Chino"],
      selectedMarketCount: 1,
      plannedProviderRequestCount: 1,
    });
    const runRepository = new FakeRunRepository([
      claimedResult(mismatched, 1),
    ]);
    const sourceFactory = sourceReturning([], 1);

    await expect(
      createUseCase({ runRepository, sourceFactory }).execute({
        signaledRunId: runId,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        failureCode: "unsupported-request-plan",
      }),
    );
    expect(sourceFactory.createCalls).toEqual([]);
    expect(runRepository.completions).toEqual([
      expect.objectContaining({
        outcome: "failed",
        actualProviderRequestCount: 0,
        returnedListingCount: 0,
        failureCode: "unsupported-request-plan",
      }),
    ]);
  });

  it("does not create scheduled work for a stale opaque signal", async () => {
    const runRepository = new FakeRunRepository([
      { status: "no-queued-run" },
    ]);
    await expect(
      createUseCase({ runRepository }).execute({ signaledRunId: runId }),
    ).resolves.toEqual({ status: "no-work" });
    expect(runRepository.queued).toEqual([]);
  });
});

interface RecordingSourceFactory extends ListingRefreshSourceFactoryPort {
  readonly createCalls: Parameters<ListingRefreshSourceFactoryPort["create"]>[0][];
}

class FakeRunRepository implements ListingRefreshRunRepositoryPort {
  readonly claims: ClaimLatestListingRefreshRunInput[] = [];
  readonly queued: QueueListingRefreshInput[] = [];
  readonly completions: CompleteListingRefreshRunInput[] = [];

  constructor(
    private readonly claimResults: ClaimLatestListingRefreshRunResult[],
  ) {}

  async claimLatestRun(input: ClaimLatestListingRefreshRunInput) {
    this.claims.push(input);
    const result = this.claimResults.shift();
    if (result === undefined) throw new Error("Unexpected claim");
    return result;
  }

  async queueRun(input: QueueListingRefreshInput): Promise<ListingRefreshRun> {
    this.queued.push(input);
    return createRun({
      runId: input.runId,
      requestedRevision: input.revision,
      requestedAt: input.requestedAt,
      triggerReason: input.triggerReason,
      selectedMarkets: input.plan.selectedMarkets,
      selectedMarketCount: input.plan.selectedMarketCount,
      plannedProviderRequestCount: input.plan.plannedProviderRequestCount,
      effectiveRevision: null,
      status: "queued",
    });
  }

  async completeRun(
    input: CompleteListingRefreshRunInput,
  ): Promise<CompleteListingRefreshRunResult> {
    this.completions.push(input);
    return {
      status: "completed",
      run:
        input.outcome === "succeeded"
          ? createRun({
              status: "succeeded",
              effectiveRevision: input.expectedEffectiveRevision,
              startedAt: requestedAt,
              completedAt: input.completedAt,
              actualProviderRequestCount: input.actualProviderRequestCount,
              returnedListingCount: input.returnedListingCount,
              publishedCurrentCount: input.publishedCurrentCount,
            })
          : createRun({
              status: "failed",
              effectiveRevision: input.expectedEffectiveRevision,
              startedAt: requestedAt,
              completedAt: input.completedAt,
              actualProviderRequestCount: input.actualProviderRequestCount,
              returnedListingCount: input.returnedListingCount,
              failureCode: input.failureCode,
            }),
    };
  }

  async findLatestRun(): Promise<ListingRefreshRun | null> {
    return null;
  }
}

class FakeAlertRepository implements ListingAlertStateRepositoryPort {
  baselineInitialized = true;
  baselineInitializations = 0;
  previous: ListingPriceObservation[] = [];
  pending: ListingAlertEvent[] = [];
  savedTransitions: ListingAlertTransition[] = [];

  async isPriceObservationBaselineInitialized() {
    return this.baselineInitialized;
  }
  async initializePriceObservationBaseline() {
    this.baselineInitialized = true;
    this.baselineInitializations += 1;
  }
  async findPriceObservations() { return this.previous; }
  async saveListingAlertTransitions(transitions: ListingAlertTransition[]) {
    this.savedTransitions.push(...transitions);
  }
  async findPendingListingAlertEvents() { return this.pending; }
  async markListingAlertEventsSent() {}
}

function createUseCase(overrides: {
  runRepository: FakeRunRepository;
  alerts?: FakeAlertRepository;
  sourceFactory?: RecordingSourceFactory;
}) {
  const ids = [claimToken, scheduledRunId, claimToken];
  return new ReconcileListingRefresh({
    alertRepository: overrides.alerts ?? new FakeAlertRepository(),
    createId: () => ids.shift() ?? claimToken,
    notifications: noNotifications(),
    now: sequenceClock(),
    profileQuery: {
      async findPrimaryProfile() {
        return createProfile();
      },
    },
    runRepository: overrides.runRepository,
    sourceFactory: overrides.sourceFactory ?? sourceReturning([], 1),
  });
}

function sourceReturning(
  listings: RentCastNormalizedListing[],
  requestCount: number,
): RecordingSourceFactory {
  return {
    createCalls: [],
    create(input) {
      this.createCalls.push(input);
      return {
        async getActiveSaleListings() {
          for (let index = 0; index < requestCount; index += 1) {
            input.onProviderRequest();
          }
          input.onProviderResponse(listings.length);
          return listings;
        },
      };
    },
  };
}

function claimedResult(
  run: ListingRefreshRun,
  appliedRevision: number,
): ClaimLatestListingRefreshRunResult {
  return {
    status: "claimed",
    claim: {
      claimToken,
      run: {
        ...run,
        status: "running",
        effectiveRevision: run.requestedRevision,
        startedAt: requestedAt,
      },
      criteria: createProfile().criteria,
      appliedRevision,
    },
  };
}

function createRun(overrides: Partial<ListingRefreshRun> = {}): ListingRefreshRun {
  return {
    runId,
    profileKey: "primary",
    requestedRevision: 1,
    effectiveRevision: 1,
    triggerReason: "criteria-change",
    status: "running",
    requestedAt,
    startedAt: requestedAt,
    completedAt: null,
    selectedMarkets: ["Corona"],
    selectedMarketCount: 1,
    plannedProviderRequestCount: 1,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
    ...overrides,
  };
}

function createProfile(): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: {
      ...defaultListingSearchCriteria,
      cities: ["Corona"],
    },
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt: "2026-08-20T15:00:00.000Z",
    updatedAt: "2026-08-20T15:00:00.000Z",
  };
}

function createListing(): RentCastNormalizedListing {
  return {
    source: "rentcast",
    sourceListingId: "provider-id",
    mlsName: "CRMLS",
    mlsNumber: "PW26000001",
    formattedAddress: "123 Main St, Corona, CA 92879",
    addressLine1: "123 Main St",
    addressLine2: null,
    city: "Corona",
    state: "CA",
    zipCode: "92879",
    latitude: 33.8753,
    longitude: -117.5664,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 3,
    price: 825000,
    status: "Active",
    listedDate: "2026-09-01",
    lastSeenDate: "2026-09-10",
    firstDiscoveredAt: "2026-09-10T15:04:00.000Z",
  };
}

function noNotifications(): ListingAlertNotificationPort {
  return {
    async sendListingAlerts() {
      throw new Error("Unexpected notification");
    },
  };
}

function sequenceClock(): () => Date {
  const values = [requestedAt, requestedAt, requestedAt, completedAt, completedAt];
  return () => new Date(values.shift() ?? completedAt);
}
