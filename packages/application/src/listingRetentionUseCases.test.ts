import { describe, expect, it, vi } from "vitest";

import {
  ExecuteListingRetention,
  InvalidListingRetentionClockError,
  InvalidListingRetentionInputError,
  InvalidListingRetentionResultError,
  PreviewListingRetention,
} from "./listingRetentionUseCases.js";
import {
  LISTING_RETENTION_DEFAULTS,
  type ExecuteListingRetentionInput,
  type ListingRetentionCandidate,
  type ListingRetentionRepositoryPort,
} from "./listingRetentionContracts.js";

describe("listing retention use cases", () => {
  it("previews aggregate counts without exposing candidate identities or deleting", async () => {
    const repository = new FakeRetentionRepository([
      candidate("search-run", "run-secret", "2026-01-01T00:00:00.000Z"),
      candidate(
        "provider-listing",
        "listing-secret",
        "2026-02-01T00:00:00.000Z",
      ),
    ]);
    const preview = new PreviewListingRetention({
      repository,
      now: sequenceClock(
        "2026-09-10T15:00:00.000Z",
        "2026-09-10T15:00:01.000Z",
      ),
    });

    const report = await preview.execute(inspectInput);

    expect(report).toMatchObject({
      mode: "preview",
      candidates: {
        searchRuns: 1,
        searchMemberships: 0,
        providerListings: 1,
        alertEvents: 0,
        total: 2,
      },
      deleted: { total: 0 },
      hasMore: false,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(repository.executeCalls).toHaveLength(0);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it("treats a full preview batch as possibly having more work", async () => {
    const repository = new FakeRetentionRepository([
      candidate("alert-event", "event-1", "2026-01-01T00:00:00.000Z"),
      candidate("alert-event", "event-2", "2026-01-02T00:00:00.000Z"),
    ]);
    const preview = new PreviewListingRetention({
      repository,
      now: sequenceClock(
        "2026-09-10T15:00:00.000Z",
        "2026-09-10T15:00:00.000Z",
      ),
    });

    await expect(
      preview.execute({
        ...inspectInput,
        policy: { ...LISTING_RETENTION_DEFAULTS, batchSize: 2 },
      }),
    ).resolves.toMatchObject({ hasMore: true });
  });

  it("rejects a future cutoff, regressing clock, and unsafe repository output", async () => {
    const futurePreview = new PreviewListingRetention({
      repository: new FakeRetentionRepository([]),
      now: () => new Date("2026-09-10T14:59:59.000Z"),
    });
    await expect(futurePreview.execute(inspectInput)).rejects.toThrow(
      InvalidListingRetentionInputError,
    );

    const regressingPreview = new PreviewListingRetention({
      repository: new FakeRetentionRepository([]),
      now: sequenceClock(
        "2026-09-10T15:00:01.000Z",
        "2026-09-10T15:00:00.000Z",
      ),
    });
    await expect(regressingPreview.execute(inspectInput)).rejects.toThrow(
      InvalidListingRetentionClockError,
    );

    const duplicate = candidate(
      "provider-listing",
      "same-listing",
      "2026-01-01T00:00:00.000Z",
    );
    const unsafePreview = new PreviewListingRetention({
      repository: new FakeRetentionRepository([duplicate, duplicate]),
      now: sequenceClock(
        "2026-09-10T15:00:00.000Z",
        "2026-09-10T15:00:00.000Z",
      ),
    });
    await expect(unsafePreview.execute(inspectInput)).rejects.toThrow(
      InvalidListingRetentionResultError,
    );
  });

  it("executes only the separately approved aggregate batch", async () => {
    const repository = new FakeRetentionRepository([]);
    const execute = new ExecuteListingRetention({ repository });

    const report = await execute.execute(executeInput);

    expect(repository.executeCalls).toEqual([executeInput]);
    expect(report.mode).toBe("execute");
    expect(report.deleted).toEqual(executeInput.expectedCandidates);
  });

  it("rejects an inconsistent expected total before repository execution", async () => {
    const repository = new FakeRetentionRepository([]);
    const execute = new ExecuteListingRetention({ repository });

    await expect(
      execute.execute({
        ...executeInput,
        expectedCandidates: {
          ...executeInput.expectedCandidates,
          total: 2,
        },
      }),
    ).rejects.toThrow(InvalidListingRetentionInputError);
    expect(repository.executeCalls).toHaveLength(0);
  });
});

const inspectInput = {
  asOf: "2026-09-10T15:00:00.000Z",
  policy: LISTING_RETENTION_DEFAULTS,
};

const executeInput: ExecuteListingRetentionInput = {
  ...inspectInput,
  expectedCandidates: {
    searchRuns: 1,
    searchMemberships: 0,
    providerListings: 0,
    alertEvents: 0,
    total: 1,
  },
};

class FakeRetentionRepository implements ListingRetentionRepositoryPort {
  readonly executeCalls: ExecuteListingRetentionInput[] = [];

  constructor(private readonly candidates: readonly ListingRetentionCandidate[]) {}

  async listCandidates(): Promise<readonly ListingRetentionCandidate[]> {
    return this.candidates;
  }

  async execute(
    input: ExecuteListingRetentionInput,
  ): Promise<ReturnType<ListingRetentionRepositoryPort["execute"]> extends Promise<infer Result> ? Result : never> {
    this.executeCalls.push(input);
    return {
      mode: "execute",
      asOf: input.asOf,
      startedAt: input.asOf,
      completedAt: input.asOf,
      candidates: input.expectedCandidates,
      deleted: input.expectedCandidates,
      hasMore: false,
    };
  }
}

function candidate(
  recordKind: ListingRetentionCandidate["recordKind"],
  recordKey: string,
  retainedThrough: string,
): ListingRetentionCandidate {
  return { recordKind, recordKey, retainedThrough };
}

function sequenceClock(...timestamps: string[]): () => Date {
  const now = vi.fn(() => {
    const timestamp = timestamps.shift();
    if (timestamp === undefined) {
      throw new Error("Test clock was exhausted");
    }
    return new Date(timestamp);
  });
  return now;
}
