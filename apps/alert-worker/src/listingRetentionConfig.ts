import {
  LISTING_RETENTION_DEFAULTS,
  normalizeListingRetentionPolicy,
  type ListingRetentionPolicy,
} from "@chaoran-property-intelligence/application";

const retentionPolicyVariables = Object.freeze({
  runDetailDays: "LISTING_RETENTION_RUN_DETAIL_DAYS",
  inactiveMembershipDays: "LISTING_RETENTION_INACTIVE_MEMBERSHIP_DAYS",
  outOfScopeMembershipDays: "LISTING_RETENTION_OUT_OF_SCOPE_MEMBERSHIP_DAYS",
  unreferencedProviderListingDays:
    "LISTING_RETENTION_PROVIDER_LISTING_DAYS",
  alertEventDays: "LISTING_RETENTION_ALERT_EVENT_DAYS",
  batchSize: "LISTING_RETENTION_BATCH_SIZE",
} as const);

export function loadListingRetentionPolicy(
  environment: Readonly<Record<string, string | undefined>>,
): ListingRetentionPolicy {
  const configured: Record<keyof ListingRetentionPolicy, number> = {
    ...LISTING_RETENTION_DEFAULTS,
  };
  for (const [property, variable] of Object.entries(
    retentionPolicyVariables,
  ) as [keyof ListingRetentionPolicy, string][]) {
    const raw = environment[variable];
    if (raw === undefined || raw.trim().length === 0) {
      continue;
    }
    if (!/^\d+$/u.test(raw)) {
      throw new Error(`Invalid listing retention setting: ${variable}`);
    }
    configured[property] = Number(raw);
  }

  try {
    return normalizeListingRetentionPolicy(configured);
  } catch {
    throw new Error("Invalid listing retention policy");
  }
}
