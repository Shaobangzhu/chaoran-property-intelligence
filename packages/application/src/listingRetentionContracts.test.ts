import { describe, expect, it } from "vitest";

import {
  InvalidListingRetentionContractError,
  LISTING_RETENTION_DEFAULTS,
  normalizeListingRetentionCandidate,
  normalizeListingRetentionPolicy,
  normalizeListingRetentionReport,
} from "./listingRetentionContracts.js";

const asOf = "2026-09-07T15:00:00.000Z";

describe("listing retention contracts", () => {
  it("normalizes and freezes the accepted default policy", () => {
    const policy = normalizeListingRetentionPolicy(LISTING_RETENTION_DEFAULTS);

    expect(policy).toEqual({
      runDetailDays: 90,
      inactiveMembershipDays: 90,
      outOfScopeMembershipDays: 90,
      unreferencedProviderListingDays: 180,
      alertEventDays: 365,
      batchSize: 500,
    });
    expect(Object.isFrozen(LISTING_RETENTION_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it.each([
    { ...LISTING_RETENTION_DEFAULTS, batchSize: 0 },
    { ...LISTING_RETENTION_DEFAULTS, runDetailDays: 90.5 },
    { ...LISTING_RETENTION_DEFAULTS, unknown: 1 },
  ])("rejects an unsafe or inexact retention policy", (policy) => {
    expect(() => normalizeListingRetentionPolicy(policy)).toThrow(
      InvalidListingRetentionContractError,
    );
  });

  it("normalizes a bounded retention candidate", () => {
    const candidate = normalizeListingRetentionCandidate({
      recordKind: "provider-listing",
      recordKey: "019cdd45-61b1-7a63-9976-b9d945721e14",
      retainedThrough: "2026-03-11T15:00:00.000Z",
    });

    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it("deeply freezes an internally consistent preview report", () => {
    const report = normalizeListingRetentionReport(createReport());

    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.candidates)).toBe(true);
    expect(Object.isFrozen(report.deleted)).toBe(true);
  });

  it.each([
    { ...createReport(), asOf: "September 7, 2026" },
    {
      ...createReport(),
      completedAt: "2026-09-07T14:59:59.000Z",
    },
    {
      ...createReport(),
      candidates: { ...createReport().candidates, total: 3 },
    },
    {
      ...createReport(),
      deleted: { ...createReport().deleted, searchRuns: 1, total: 1 },
    },
    {
      ...createReport(),
      candidates: {
        ...createReport().candidates,
        searchRuns: Number.MAX_SAFE_INTEGER + 1,
        total: Number.MAX_SAFE_INTEGER + 2,
      },
    },
  ])("rejects unsafe or contradictory retention reports", (report) => {
    expect(() => normalizeListingRetentionReport(report)).toThrow(
      InvalidListingRetentionContractError,
    );
  });
});

function createReport() {
  return {
    mode: "preview",
    asOf,
    startedAt: "2026-09-07T15:00:00.000Z",
    completedAt: "2026-09-07T15:00:01.000Z",
    candidates: {
      searchRuns: 2,
      searchMemberships: 1,
      providerListings: 1,
      alertEvents: 0,
      total: 4,
    },
    deleted: {
      searchRuns: 0,
      searchMemberships: 0,
      providerListings: 0,
      alertEvents: 0,
      total: 0,
    },
    hasMore: false,
  };
}
