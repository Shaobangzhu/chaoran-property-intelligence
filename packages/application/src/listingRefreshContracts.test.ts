import { describe, expect, it } from "vitest";

import {
  defaultListingSearchCriteria,
  normalizeListingSearchCriteria,
} from "@chaoran-property-intelligence/domain";

import {
  InvalidListingRefreshContractError,
  createListingRefreshRequestPlan,
  normalizeClaimLatestListingRefreshRunResult,
  normalizeCompleteListingRefreshRunResult,
  normalizeListingRefreshRequestPlan,
  normalizeListingRefreshRun,
  normalizeListingSearchMembership,
} from "./listingRefreshContracts.js";

const runId = "019cdd45-61b1-7a63-9976-b9d945721e12";
const nextRunId = "019cdd45-61b1-7a63-9976-b9d945721e13";
const listingId = "019cdd45-61b1-7a63-9976-b9d945721e14";
const requestedAt = "2026-09-07T15:00:00.000Z";
const startedAt = "2026-09-07T15:00:01.000Z";
const completedAt = "2026-09-07T15:00:05.000Z";

describe("listing refresh request plan contract", () => {
  it.each([
    [1, ["Irvine"]],
    [5, ["Chino", "Chino Hills", "Eastvale", "Corona", "Jurupa Valley"]],
    [
      6,
      [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
      ],
    ],
    [
      7,
      [
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
        "Irvine",
      ],
    ],
  ] as const)(
    "plans exactly %i provider request(s) for the selected markets",
    (count, selectedMarkets) => {
      const plan = normalizeListingRefreshRequestPlan({
        selectedMarkets,
        selectedMarketCount: count,
        plannedProviderRequestCount: count,
      });

      expect(plan.plannedProviderRequestCount).toBe(count);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.selectedMarkets)).toBe(true);
    },
  );

  it("derives the request plan from normalized criteria", () => {
    const plan = createListingRefreshRequestPlan(
      normalizeListingSearchCriteria({
        ...defaultListingSearchCriteria,
        cities: ["Irvine", "Chino"],
      }),
    );

    expect(plan).toEqual({
      selectedMarkets: ["Chino", "Irvine"],
      selectedMarketCount: 2,
      plannedProviderRequestCount: 2,
    });
  });

  it.each([
    {
      selectedMarkets: ["Irvine"],
      selectedMarketCount: 1,
      plannedProviderRequestCount: 2,
    },
    {
      selectedMarkets: ["Irvine", "Irvine"],
      selectedMarketCount: 2,
      plannedProviderRequestCount: 2,
    },
    {
      selectedMarkets: ["Irvine", "Chino"],
      selectedMarketCount: 2,
      plannedProviderRequestCount: 2,
    },
    {
      selectedMarkets: ["Irvine"],
      selectedMarketCount: Number.MAX_SAFE_INTEGER + 1,
      plannedProviderRequestCount: 1,
    },
  ])("rejects an unsafe or inconsistent request plan", (plan) => {
    expect(() => normalizeListingRefreshRequestPlan(plan)).toThrow(
      InvalidListingRefreshContractError,
    );
  });
});

describe("listing refresh run contract", () => {
  it.each([
    createRun(),
    createRun({
      effectiveRevision: 2,
      status: "running",
      startedAt,
    }),
    createRun({
      effectiveRevision: 2,
      status: "succeeded",
      startedAt,
      completedAt,
      actualProviderRequestCount: 1,
      returnedListingCount: 25,
      publishedCurrentCount: 20,
    }),
    createRun({
      effectiveRevision: 2,
      status: "failed",
      startedAt,
      completedAt,
      actualProviderRequestCount: 1,
      returnedListingCount: 10,
      failureCode: "provider-timeout",
    }),
    createRun({
      status: "superseded",
      completedAt,
      supersededByRunId: nextRunId,
    }),
  ])("accepts and deeply freezes a valid $status run", (input) => {
    const run = normalizeListingRefreshRun(input);

    expect(run).toEqual(input);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.selectedMarkets)).toBe(true);
  });

  it.each([
    { ...createRun(), extra: true },
    { ...createRun(), requestedAt: "2026-09-07 15:00:00" },
    {
      ...createRun(),
      selectedMarketCount: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      ...createRun(),
      status: "running",
      effectiveRevision: 2,
      startedAt: "2026-09-07T14:59:59.000Z",
    },
    {
      ...createRun(),
      status: "succeeded",
      effectiveRevision: 2,
      startedAt,
      completedAt,
      actualProviderRequestCount: 0,
    },
    {
      ...createRun(),
      status: "failed",
      completedAt,
      failureCode: "Provider timeout: https://secret.example",
    },
    {
      ...createRun(),
      status: "superseded",
      completedAt,
      supersededByRunId: runId,
    },
  ])("rejects malformed or impossible run state", (input) => {
    expect(() => normalizeListingRefreshRun(input)).toThrow(
      InvalidListingRefreshContractError,
    );
  });
});

describe("listing refresh claim and completion result contracts", () => {
  it("normalizes a running claim and deeply freezes its criteria", () => {
    const result = normalizeClaimLatestListingRefreshRunResult({
      status: "claimed",
      claim: {
        claimToken: nextRunId,
        run: createRun({
          effectiveRevision: 2,
          status: "running",
          startedAt,
        }),
        criteria: defaultListingSearchCriteria,
      },
    });

    expect(result.status).toBe("claimed");
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === "claimed") {
      expect(Object.isFrozen(result.claim)).toBe(true);
      expect(Object.isFrozen(result.claim.criteria)).toBe(true);
      expect(Object.isFrozen(result.claim.criteria.cities)).toBe(true);
    }
  });

  it.each([
    { status: "no-queued-run" },
    { status: "already-running" },
  ])("accepts the exact non-claim result $status", (result) => {
    expect(normalizeClaimLatestListingRefreshRunResult(result)).toEqual(result);
  });

  it.each([
    { status: "no-queued-run", extra: true },
    {
      status: "claimed",
      claim: {
        claimToken: nextRunId,
        run: createRun(),
        criteria: defaultListingSearchCriteria,
      },
    },
  ])("rejects an invalid claim result", (result) => {
    expect(() => normalizeClaimLatestListingRefreshRunResult(result)).toThrow(
      InvalidListingRefreshContractError,
    );
  });

  it.each([
    { status: "stale-claim" },
    { status: "criteria-revision-conflict" },
  ])("accepts the exact completion guard result $status", (result) => {
    expect(normalizeCompleteListingRefreshRunResult(result)).toEqual(result);
  });

  it("represents repeated completion without reapplying publication", () => {
    const succeededRun = createRun({
      effectiveRevision: 2,
      status: "succeeded",
      startedAt,
      completedAt,
      actualProviderRequestCount: 1,
      returnedListingCount: 25,
      publishedCurrentCount: 20,
    });

    expect(
      normalizeCompleteListingRefreshRunResult({
        status: "already-completed",
        run: succeededRun,
      }),
    ).toEqual({ status: "already-completed", run: succeededRun });
  });

  it("rejects a completion result that contains a nonterminal run", () => {
    expect(() =>
      normalizeCompleteListingRefreshRunResult({
        status: "completed",
        run: createRun({
          effectiveRevision: 2,
          status: "running",
          startedAt,
        }),
      }),
    ).toThrow(InvalidListingRefreshContractError);
  });
});

describe("listing search membership contract", () => {
  it.each([
    createMembership(),
    createMembership({
      lifecycleState: "out_of_scope",
    }),
    createMembership({
      lifecycleState: "missing",
      consecutiveCompleteRunAbsenceCount: 1,
    }),
    createMembership({
      lifecycleState: "inactive",
      consecutiveCompleteRunAbsenceCount: 2,
      inactiveAt: completedAt,
    }),
    createMembership({ lifecycleState: "sold" }),
  ])("accepts and freezes a consistent $lifecycleState membership", (input) => {
    const membership = normalizeListingSearchMembership(input);

    expect(membership).toEqual(input);
    expect(Object.isFrozen(membership)).toBe(true);
  });

  it.each([
    { ...createMembership(), unknown: true },
    { ...createMembership(), firstMatchedAt: "invalid" },
    {
      ...createMembership(),
      lastMatchedAt: "2026-09-07T14:59:59.000Z",
    },
    {
      ...createMembership(),
      lifecycleState: "current",
      consecutiveCompleteRunAbsenceCount: 1,
    },
    {
      ...createMembership(),
      lifecycleState: "missing",
      consecutiveCompleteRunAbsenceCount: 0,
    },
    {
      ...createMembership(),
      lifecycleState: "inactive",
      consecutiveCompleteRunAbsenceCount: 2,
      inactiveAt: null,
    },
  ])("rejects malformed or impossible membership state", (input) => {
    expect(() => normalizeListingSearchMembership(input)).toThrow(
      InvalidListingRefreshContractError,
    );
  });
});

function createRun(overrides: Record<string, unknown> = {}) {
  return {
    runId,
    profileKey: "primary",
    requestedRevision: 2,
    effectiveRevision: null,
    triggerReason: "criteria-change",
    status: "queued",
    requestedAt,
    startedAt: null,
    completedAt: null,
    selectedMarkets: ["Irvine"],
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

function createMembership(overrides: Record<string, unknown> = {}) {
  return {
    profileKey: "primary",
    listingId,
    appliedRevision: 2,
    lastSuccessfulRunId: runId,
    lifecycleState: "current",
    firstMatchedAt: requestedAt,
    lastMatchedAt: startedAt,
    lastServerObservedAt: completedAt,
    consecutiveCompleteRunAbsenceCount: 0,
    inactiveAt: null,
    ...overrides,
  };
}
