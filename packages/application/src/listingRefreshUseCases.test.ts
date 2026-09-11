import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
} from "@chaoran-property-intelligence/domain";

import type {
  ClaimLatestListingRefreshRunInput,
  ClaimLatestListingRefreshRunResult,
  CompleteListingRefreshRunInput,
  CompleteListingRefreshRunResult,
  ListingRefreshDispatchPort,
  ListingRefreshRun,
  ListingRefreshRunRepositoryPort,
  ListingSearchProfileRefreshRepositoryPort,
  QueueListingRefreshInput,
  SaveListingSearchProfileAndQueueRefreshInput,
  SaveListingSearchProfileAndQueueRefreshResult,
} from "./listingRefreshContracts.js";
import type {
  ListingSearchProfile,
  ListingSearchProfileQueryPort,
} from "./listingSearchProfile.js";
import {
  GetLatestListingRefreshStatus,
  ListingRefreshRetryUnavailableError,
  RetryLatestListingRefresh,
  UpdateListingSearchCriteriaAndQueueRefresh,
} from "./listingSearchCriteriaUseCases.js";

const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const criteriaRunId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const retryRunId = "0198c7d2-7668-7775-b0fc-b789690a60c3";
const requestedAt = "2026-09-10T15:00:00.000Z";

describe("listing refresh API use cases", () => {
  it("commits a changed criteria revision and queued run before dispatch", async () => {
    const order: string[] = [];
    const profile = createProfile({
      criteria: normalizeListingSearchCriteria({
        ...defaultListingSearchCriteria,
        cities: ["Corona"],
        propertyType: "Condo",
      }),
      revision: 2,
      updatedAt: requestedAt,
      updatedByUserId: actorUserId,
    });
    const repository: ListingSearchProfileRefreshRepositoryPort = {
      async savePrimaryProfileAndQueueRefresh(input) {
        order.push("commit");
        expect(input).toMatchObject({
          expectedRevision: 1,
          runId: criteriaRunId,
          plan: {
            selectedMarkets: ["Corona"],
            plannedProviderRequestCount: 1,
          },
        });
        return {
          status: "updated",
          profile,
          run: createRun({
            requestedRevision: 2,
            runId: criteriaRunId,
            requestedAt,
            selectedMarkets: ["Corona"],
            selectedMarketCount: 1,
            plannedProviderRequestCount: 1,
          }),
        };
      },
    };
    const dispatcher: ListingRefreshDispatchPort = {
      async dispatch(runId) {
        order.push("dispatch");
        expect(runId).toBe(criteriaRunId);
      },
    };

    const result = await new UpdateListingSearchCriteriaAndQueueRefresh({
      createId: () => criteriaRunId,
      dispatcher,
      now: () => new Date(requestedAt),
      repository,
      runRepository: new FakeRunRepository(),
    }).execute({
      actorUserId,
      expectedRevision: 1,
      criteria: {
        propertyType: "Condo",
        minimumPrice: defaultListingSearchCriteria.minimumPrice,
        maximumPrice: defaultListingSearchCriteria.maximumPrice,
        minimumBedrooms: defaultListingSearchCriteria.minimumBedrooms,
        minimumBathrooms: defaultListingSearchCriteria.minimumBathrooms,
        cities: ["Corona"],
      },
    });

    expect(order).toEqual(["commit", "dispatch"]);
    expect(result).toMatchObject({
      searchCriteria: { revision: 2, appliedRevision: 1 },
      refreshRun: { runId: criteriaRunId, status: "queued" },
      refreshDispatch: "dispatched",
    });
  });

  it("does not queue or dispatch an unchanged save and returns latest state", async () => {
    const latest = createRun({ status: "succeeded", effectiveRevision: 1,
      startedAt: "2026-09-09T15:00:00.000Z",
      completedAt: "2026-09-09T15:01:00.000Z",
      actualProviderRequestCount: defaultListingSearchCriteria.cities.length,
      returnedListingCount: 10,
      publishedCurrentCount: 10,
    });
    const runRepository = new FakeRunRepository(latest);
    let dispatchCount = 0;
    const repository: ListingSearchProfileRefreshRepositoryPort = {
      async savePrimaryProfileAndQueueRefresh() {
        return { status: "unchanged", profile: createProfile() };
      },
    };

    const result = await new UpdateListingSearchCriteriaAndQueueRefresh({
      createId: () => criteriaRunId,
      dispatcher: {
        async dispatch() {
          dispatchCount += 1;
        },
      },
      now: () => new Date(requestedAt),
      repository,
      runRepository,
    }).execute({
      actorUserId,
      expectedRevision: 1,
      criteria: editableDefaultCriteria(),
    });

    expect(dispatchCount).toBe(0);
    expect(runRepository.queued).toEqual([]);
    expect(result).toMatchObject({
      refreshRun: { status: "succeeded" },
      refreshDispatch: "not-required",
    });
  });

  it("reports dispatch failure while preserving the committed queued result", async () => {
    const profile = createProfile({
      criteria: normalizeListingSearchCriteria({
        ...defaultListingSearchCriteria,
        propertyType: "Condo",
      }),
      revision: 2,
      updatedAt: requestedAt,
      updatedByUserId: actorUserId,
    });
    const repository: ListingSearchProfileRefreshRepositoryPort = {
      async savePrimaryProfileAndQueueRefresh(input) {
        return {
          status: "updated",
          profile,
          run: createRun({
            requestedRevision: 2,
            runId: input.runId,
            requestedAt,
          }),
        };
      },
    };

    const result = await new UpdateListingSearchCriteriaAndQueueRefresh({
      createId: () => criteriaRunId,
      dispatcher: {
        async dispatch() {
          throw new Error("signal unavailable");
        },
      },
      now: () => new Date(requestedAt),
      repository,
      runRepository: new FakeRunRepository(),
    }).execute({
      actorUserId,
      expectedRevision: 1,
      criteria: { ...editableDefaultCriteria(), propertyType: "Condo" },
    });

    expect(result.refreshRun?.status).toBe("queued");
    expect(result.refreshDispatch).toBe("failed");
  });

  it("queues and dispatches an explicitly confirmed retry for the current failed revision", async () => {
    const failed = createRun({
      status: "failed",
      effectiveRevision: 1,
      startedAt: "2026-09-09T15:00:00.000Z",
      completedAt: "2026-09-09T15:01:00.000Z",
      failureCode: "provider-timeout",
      actualProviderRequestCount: 2,
    });
    const runRepository = new FakeRunRepository(failed);
    const dispatched: string[] = [];
    const result = await new RetryLatestListingRefresh({
      createId: () => retryRunId,
      dispatcher: {
        async dispatch(runId) {
          dispatched.push(runId);
        },
      },
      now: () => new Date(requestedAt),
      profileRepository: staticProfileRepository(createProfile()),
      runRepository,
    }).execute({
      expectedRevision: 1,
      confirmedPlannedProviderRequestCount:
        defaultListingSearchCriteria.cities.length,
    });

    expect(runRepository.queued).toEqual([
      expect.objectContaining({
        runId: retryRunId,
        revision: 1,
        triggerReason: "manual-retry",
        plan: expect.objectContaining({
          plannedProviderRequestCount:
            defaultListingSearchCriteria.cities.length,
        }),
      }),
    ]);
    expect(dispatched).toEqual([retryRunId]);
    expect(result.refreshRun.triggerReason).toBe("manual-retry");
  });

  it("re-dispatches an already durable queued run without creating a duplicate", async () => {
    const queued = createRun();
    const runRepository = new FakeRunRepository(queued);
    const dispatched: string[] = [];
    const result = await new RetryLatestListingRefresh({
      createId: () => retryRunId,
      dispatcher: {
        async dispatch(runId) {
          dispatched.push(runId);
        },
      },
      now: () => new Date(requestedAt),
      profileRepository: staticProfileRepository(createProfile()),
      runRepository,
    }).execute({
      expectedRevision: 1,
      confirmedPlannedProviderRequestCount:
        defaultListingSearchCriteria.cities.length,
    });

    expect(runRepository.queued).toEqual([]);
    expect(dispatched).toEqual([criteriaRunId]);
    expect(result.refreshRun).toEqual(queued);
  });

  it("rejects retry when revision, state, or confirmed request count is stale", async () => {
    const useCase = new RetryLatestListingRefresh({
      createId: () => retryRunId,
      dispatcher: { async dispatch() {} },
      now: () => new Date(requestedAt),
      profileRepository: staticProfileRepository(createProfile()),
      runRepository: new FakeRunRepository(
        createRun({
          status: "succeeded",
          effectiveRevision: 1,
          startedAt: "2026-09-09T15:00:00.000Z",
          completedAt: "2026-09-09T15:01:00.000Z",
          actualProviderRequestCount:
            defaultListingSearchCriteria.cities.length,
        }),
      ),
    });

    await expect(
      useCase.execute({
        expectedRevision: 1,
        confirmedPlannedProviderRequestCount:
          defaultListingSearchCriteria.cities.length,
      }),
    ).rejects.toThrow(ListingRefreshRetryUnavailableError);
  });

  it("normalizes the latest run before returning it", async () => {
    const latest = createRun();
    await expect(
      new GetLatestListingRefreshStatus(
        new FakeRunRepository(latest),
      ).execute(),
    ).resolves.toEqual(latest);
  });
});

class FakeRunRepository implements ListingRefreshRunRepositoryPort {
  readonly queued: QueueListingRefreshInput[] = [];

  constructor(private latest: ListingRefreshRun | null = null) {}

  async findLatestRun(): Promise<ListingRefreshRun | null> {
    return this.latest;
  }

  async queueRun(input: QueueListingRefreshInput): Promise<ListingRefreshRun> {
    this.queued.push(input);
    const run = createRun({
      runId: input.runId,
      requestedRevision: input.revision,
      triggerReason: input.triggerReason,
      requestedAt: input.requestedAt,
      selectedMarkets: input.plan.selectedMarkets,
      selectedMarketCount: input.plan.selectedMarketCount,
      plannedProviderRequestCount: input.plan.plannedProviderRequestCount,
    });
    this.latest = run;
    return run;
  }

  async claimLatestRun(
    _input: ClaimLatestListingRefreshRunInput,
  ): Promise<ClaimLatestListingRefreshRunResult> {
    return { status: "no-queued-run" };
  }

  async completeRun(
    _input: CompleteListingRefreshRunInput,
  ): Promise<CompleteListingRefreshRunResult> {
    return { status: "stale-claim" };
  }
}

function createProfile(
  overrides: Partial<ListingSearchProfile> = {},
): ListingSearchProfile {
  return {
    profileKey: "primary",
    schemaVersion: 1,
    criteria: defaultListingSearchCriteria,
    revision: 1,
    appliedRevision: 1,
    updatedByUserId: null,
    createdAt: "2026-08-20T15:00:00.000Z",
    updatedAt: "2026-08-20T15:00:00.000Z",
    ...overrides,
  };
}

function createRun(overrides: Partial<ListingRefreshRun> = {}): ListingRefreshRun {
  return {
    runId: criteriaRunId,
    profileKey: "primary",
    requestedRevision: 1,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt: "2026-09-09T14:00:00.000Z",
    startedAt: null,
    completedAt: null,
    selectedMarkets: defaultListingSearchCriteria.cities,
    selectedMarketCount: defaultListingSearchCriteria.cities.length,
    plannedProviderRequestCount: defaultListingSearchCriteria.cities.length,
    actualProviderRequestCount: 0,
    returnedListingCount: 0,
    publishedCurrentCount: 0,
    failureCode: null,
    supersededByRunId: null,
    ...overrides,
  };
}

function staticProfileRepository(
  profile: ListingSearchProfile,
): ListingSearchProfileQueryPort {
  return { async findPrimaryProfile() { return profile; } };
}

function editableDefaultCriteria() {
  return {
    propertyType: defaultListingSearchCriteria.propertyType,
    minimumPrice: defaultListingSearchCriteria.minimumPrice,
    maximumPrice: defaultListingSearchCriteria.maximumPrice,
    minimumBedrooms: defaultListingSearchCriteria.minimumBedrooms,
    minimumBathrooms: defaultListingSearchCriteria.minimumBathrooms,
    cities: [...defaultListingSearchCriteria.cities],
  };
}
