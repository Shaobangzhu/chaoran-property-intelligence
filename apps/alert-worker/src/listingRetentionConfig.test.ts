import { describe, expect, it } from "vitest";

import { LISTING_RETENTION_DEFAULTS } from "@chaoran-property-intelligence/application";

import { loadListingRetentionPolicy } from "./listingRetentionConfig.js";

describe("listing retention configuration", () => {
  it("uses the approved 90/180/365-day bounded defaults", () => {
    expect(loadListingRetentionPolicy({})).toEqual(
      LISTING_RETENTION_DEFAULTS,
    );
  });

  it("accepts explicit bounded overrides", () => {
    expect(
      loadListingRetentionPolicy({
        LISTING_RETENTION_RUN_DETAIL_DAYS: "120",
        LISTING_RETENTION_INACTIVE_MEMBERSHIP_DAYS: "100",
        LISTING_RETENTION_OUT_OF_SCOPE_MEMBERSHIP_DAYS: "110",
        LISTING_RETENTION_PROVIDER_LISTING_DAYS: "240",
        LISTING_RETENTION_ALERT_EVENT_DAYS: "500",
        LISTING_RETENTION_BATCH_SIZE: "25",
      }),
    ).toEqual({
      runDetailDays: 120,
      inactiveMembershipDays: 100,
      outOfScopeMembershipDays: 110,
      unreferencedProviderListingDays: 240,
      alertEventDays: 500,
      batchSize: 25,
    });
  });

  it.each([
    { LISTING_RETENTION_BATCH_SIZE: "0" },
    { LISTING_RETENTION_BATCH_SIZE: "1.5" },
    { LISTING_RETENTION_ALERT_EVENT_DAYS: "3651" },
  ])("rejects an unsafe policy before opening the database", (environment) => {
    expect(() => loadListingRetentionPolicy(environment)).toThrow(
      /Invalid listing retention/u,
    );
  });
});
