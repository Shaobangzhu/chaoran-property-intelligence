import {
  matchesCurrentListingCriteria,
  matchesListingAcquisitionCriteria,
  normalizeListingSearchCriteria,
  type ListingSearchCity,
  type ListingSearchCriteriaV1,
  type RentCastNormalizedListing,
} from "@chaoran-property-intelligence/domain";

import {
  AmbiguousListingAddressObservationError,
  createListingAlertTransition,
  prepareUniqueListingAlertCandidates,
} from "./checkListingAlerts.js";
import type { ListingSourcePort } from "./checkNewListings.js";
import type {
  ListingAlertNotificationPort,
  ListingAlertStateRepositoryPort,
} from "./listingAlertContracts.js";
import {
  createListingRefreshRequestPlan,
  LISTING_REFRESH_LIMITS,
  normalizeClaimLatestListingRefreshRunResult,
  normalizeCompleteListingRefreshRunResult,
  type ListingRefreshRunClaim,
  type ListingRefreshRunRepositoryPort,
} from "./listingRefreshContracts.js";
import {
  normalizeListingSearchProfile,
  PRIMARY_LISTING_SEARCH_PROFILE_KEY,
  type ListingSearchProfileQueryPort,
} from "./listingSearchProfile.js";

export interface ListingRefreshSourceFactoryInput {
  readonly criteria: ListingSearchCriteriaV1;
  readonly selectedMarkets: readonly ListingSearchCity[];
  readonly onProviderRequest: () => void;
  readonly onProviderResponse: (returnedListingCount: number) => void;
}

export interface ListingRefreshSourceFactoryPort {
  create(input: ListingRefreshSourceFactoryInput): ListingSourcePort;
}

export interface ReconcileListingRefreshOptions {
  readonly runRepository: ListingRefreshRunRepositoryPort;
  readonly profileQuery: ListingSearchProfileQueryPort;
  readonly alertRepository: ListingAlertStateRepositoryPort;
  readonly notifications: ListingAlertNotificationPort;
  readonly sourceFactory: ListingRefreshSourceFactoryPort;
  readonly createId: () => string;
  readonly now: () => Date;
}

export interface ReconcileListingRefreshInput {
  readonly signaledRunId: string | null;
}

export type ReconcileListingRefreshResult =
  | { readonly status: "no-work" | "already-running" }
  | {
      readonly status: "succeeded";
      readonly runId: string;
      readonly actualProviderRequestCount: number;
      readonly returnedListingCount: number;
      readonly publishedCurrentCount: number;
    };

export class InvalidListingRefreshExecutionInputError extends Error {
  constructor() {
    super("Listing refresh execution input was invalid");
    this.name = "InvalidListingRefreshExecutionInputError";
  }
}

export class ListingRefreshExecutionError extends Error {
  constructor(readonly failureCode: string) {
    super(`Listing refresh execution failed (${failureCode})`);
    this.name = "ListingRefreshExecutionError";
  }
}

export class ReconcileListingRefresh {
  constructor(private readonly options: ReconcileListingRefreshOptions) {}

  async execute(
    input: ReconcileListingRefreshInput,
  ): Promise<ReconcileListingRefreshResult> {
    const signaledRunId = normalizeExecutionInput(input);
    let claim = await this.claim(signaledRunId);

    if (claim.status === "no-queued-run" && signaledRunId === null) {
      await this.queueScheduledRun();
      claim = await this.claim(null);
    }
    if (claim.status === "no-queued-run") return { status: "no-work" };
    if (claim.status === "already-running") {
      return { status: "already-running" };
    }

    return this.executeClaim(claim.claim);
  }

  private async claim(signaledRunId: string | null) {
    return normalizeClaimLatestListingRefreshRunResult(
      await this.options.runRepository.claimLatestRun({
        profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
        signaledRunId,
        claimToken: readCreatedId(this.options.createId),
        claimedAt: readClock(this.options.now),
      }),
    );
  }

  private async queueScheduledRun(): Promise<void> {
    const profileValue = await this.options.profileQuery.findPrimaryProfile();
    if (profileValue === null) {
      throw new ListingRefreshExecutionError("profile-unavailable");
    }
    let profile;
    try {
      profile = normalizeListingSearchProfile(profileValue);
    } catch {
      throw new ListingRefreshExecutionError("profile-invalid");
    }
    const requestedAt = readClock(this.options.now);
    await this.options.runRepository.queueRun({
      runId: readCreatedId(this.options.createId),
      profileKey: PRIMARY_LISTING_SEARCH_PROFILE_KEY,
      revision: profile.revision,
      triggerReason: "scheduled",
      requestedAt,
      plan: createListingRefreshRequestPlan(profile.criteria),
    });
  }

  private async executeClaim(
    claim: ListingRefreshRunClaim,
  ): Promise<ReconcileListingRefreshResult> {
    let actualProviderRequestCount = 0;
    let returnedListingCount = 0;
    let completionRecorded = false;

    try {
      assertSupportedRequestPlan(claim);
      const alertBaselineInitialized =
        await this.options.alertRepository.isPriceObservationBaselineInitialized();
      const source = this.options.sourceFactory.create({
        criteria: claim.criteria,
        selectedMarkets: claim.run.selectedMarkets,
        onProviderRequest: () => {
          actualProviderRequestCount += 1;
          if (
            actualProviderRequestCount >
            claim.run.plannedProviderRequestCount
          ) {
            throw new ListingRefreshExecutionError(
              "provider-request-count-exceeded",
            );
          }
        },
        onProviderResponse: (count) => {
          if (!isBoundedListingCount(count)) {
            throw new ListingRefreshExecutionError(
              "provider-response-count-invalid",
            );
          }
          returnedListingCount += count;
          if (!isBoundedListingCount(returnedListingCount)) {
            throw new ListingRefreshExecutionError(
              "provider-response-count-exceeded",
            );
          }
        },
      });
      const sourceListings = await source.getActiveSaleListings();
      if (
        actualProviderRequestCount !==
          claim.run.plannedProviderRequestCount ||
        returnedListingCount !== sourceListings.length
      ) {
        throw new ListingRefreshExecutionError(
          "provider-request-accounting-mismatch",
        );
      }

      const prepared = prepareUniqueListingAlertCandidates(
        sourceListings.filter((listing) =>
          matchesListingAcquisitionCriteria(listing, claim.criteria),
        ),
      );
      const previousObservations =
        await this.options.alertRepository.findPriceObservations(
          prepared.map((candidate) => candidate.addressKey),
        );
      const previousByAddress = new Map(
        previousObservations.map((observation) => [
          observation.addressKey,
          observation,
        ]),
      );
      const completedAt = readClock(this.options.now);
      const quietBaseline =
        claim.appliedRevision !== claim.run.effectiveRevision ||
        !alertBaselineInitialized;
      const candidates = prepared.flatMap((candidate) => {
        const previous = previousByAddress.get(candidate.addressKey);
        const currentDisplayEligible = matchesCurrentListingCriteria(
          candidate.listing,
          claim.criteria,
        );
        if (previous === undefined && !currentDisplayEligible) return [];
        const transition = createListingAlertTransition(
          candidate,
          previous,
          currentDisplayEligible,
          completedAt,
        );
        return [
          {
            listing: transition.listing,
            observation: transition.observation,
            event: quietBaseline ? null : transition.event,
            acquisitionEligible: true as const,
            currentDisplayEligible,
          },
        ];
      });
      const publishedCurrentCount = candidates.filter(
        (candidate) => candidate.currentDisplayEligible,
      ).length;
      const completion = normalizeCompleteListingRefreshRunResult(
        await this.options.runRepository.completeRun({
          outcome: "succeeded",
          runId: claim.run.runId,
          claimToken: claim.claimToken,
          expectedEffectiveRevision: claim.run.effectiveRevision!,
          completedAt,
          actualProviderRequestCount,
          returnedListingCount,
          candidates,
          publishedCurrentCount,
        }),
      );
      if (
        completion.status === "stale-claim" ||
        completion.status === "criteria-revision-conflict"
      ) {
        completionRecorded = true;
        throw new ListingRefreshExecutionError(
          completion.status === "stale-claim"
            ? "stale-claim"
            : "criteria-revision-conflict",
        );
      }
      completionRecorded = true;

      if (!alertBaselineInitialized) {
        await this.options.alertRepository.initializePriceObservationBaseline(
          [],
        );
      }

      await this.deliverPendingEvents();
      return Object.freeze({
        status: "succeeded" as const,
        runId: claim.run.runId,
        actualProviderRequestCount,
        returnedListingCount,
        publishedCurrentCount,
      });
    } catch (error) {
      const failureCode = safeFailureCode(error);
      if (!completionRecorded) {
        try {
          await this.options.runRepository.completeRun({
            outcome: "failed",
            runId: claim.run.runId,
            claimToken: claim.claimToken,
            expectedEffectiveRevision: claim.run.effectiveRevision!,
            completedAt: readClock(this.options.now),
            actualProviderRequestCount,
            returnedListingCount,
            failureCode,
          });
        } catch {
          // The original bounded failure remains authoritative. A database
          // outage can leave a running claim for explicit reconciliation.
        }
      }
      throw error instanceof ListingRefreshExecutionError
        ? error
        : new ListingRefreshExecutionError(failureCode);
    }
  }

  private async deliverPendingEvents(): Promise<void> {
    const pending =
      await this.options.alertRepository.findPendingListingAlertEvents();
    if (pending.length === 0) return;
    await this.options.notifications.sendListingAlerts(pending);
    await this.options.alertRepository.markListingAlertEventsSent(
      pending.map((event) => event.eventKey),
    );
  }
}

function assertSupportedRequestPlan(claim: ListingRefreshRunClaim): void {
  const criteria = normalizeListingSearchCriteria(claim.criteria);
  const expected = createListingRefreshRequestPlan(criteria);
  if (
    JSON.stringify(claim.run.selectedMarkets) !==
      JSON.stringify(expected.selectedMarkets) ||
    claim.run.selectedMarketCount !== expected.selectedMarketCount ||
    claim.run.plannedProviderRequestCount !==
      expected.plannedProviderRequestCount ||
    claim.run.effectiveRevision === null
  ) {
    throw new ListingRefreshExecutionError("unsupported-request-plan");
  }
}

function normalizeExecutionInput(input: unknown): string | null {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("signaledRunId" in input) ||
    (input.signaledRunId !== null && !isUuid(input.signaledRunId))
  ) {
    throw new InvalidListingRefreshExecutionInputError();
  }
  return input.signaledRunId;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof ListingRefreshExecutionError) return error.failureCode;
  if (error instanceof AmbiguousListingAddressObservationError) {
    return "ambiguous-listing-address";
  }
  if (error instanceof Error) {
    if (error.name === "RentCastListingCoverageExceededError") {
      return "provider-coverage-exceeded";
    }
    if (error.name === "IncompleteRentCastListingPageError") {
      return "provider-page-incomplete";
    }
  }
  return "refresh-execution-failed";
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ListingRefreshExecutionError("clock-invalid");
  }
  return value.toISOString();
}

function readCreatedId(createId: () => string): string {
  const value = createId();
  if (!isUuid(value)) {
    throw new ListingRefreshExecutionError("id-factory-invalid");
  }
  return value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isBoundedListingCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= LISTING_REFRESH_LIMITS.maximumListingCount
  );
}
