import { describe, expect, it, vi } from "vitest";

import type {
  ExecuteListingRetentionInput,
  InspectListingRetentionInput,
  ListingRetentionCandidate,
  ListingRetentionRepositoryPort,
} from "@chaoran-property-intelligence/application";
import type {
  PostgresConnectionConfig,
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";

import { runListingRetention } from "./runListingRetention.js";

describe("runListingRetention", () => {
  it("previews through a database-only composition and always closes it", async () => {
    const database = new FakeDatabase();
    const repository = new FakeRepository();
    const createDatabase = vi.fn(
      (_connection: PostgresConnectionConfig) => database,
    );
    const createRepository = vi.fn(() => repository);

    const report = await runListingRetention(
      { mode: "preview", asOf },
      {
        environment: { DATABASE_URL: "postgresql://local-test/cpi" },
        now: () => new Date(asOf),
      },
      { createDatabase, createRepository },
    );

    expect(report.mode).toBe("preview");
    expect(report.deleted.total).toBe(0);
    expect(repository.listCalls).toHaveLength(1);
    expect(repository.executeCalls).toHaveLength(0);
    expect(database.close).toHaveBeenCalledOnce();
    expect(createDatabase).toHaveBeenCalledWith({
      kind: "connection-string",
      connectionString: "postgresql://local-test/cpi",
    });
  });

  it("executes only the approved aggregate batch without provider settings", async () => {
    const database = new FakeDatabase();
    const repository = new FakeRepository();

    const report = await runListingRetention(
      { mode: "execute", asOf, expectedCandidates: counts },
      {
        environment: { DATABASE_URL: "postgresql://local-test/cpi" },
        now: () => new Date(asOf),
      },
      {
        createDatabase: () => database,
        createRepository: () => repository,
      },
    );

    expect(report.mode).toBe("execute");
    expect(repository.executeCalls).toHaveLength(1);
    expect(repository.listCalls).toHaveLength(0);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("closes the database when repository work fails", async () => {
    const database = new FakeDatabase();
    const repository = new FakeRepository();
    repository.listCandidates = vi.fn(async () => {
      throw new Error("database unavailable");
    });

    await expect(
      runListingRetention(
        { mode: "preview", asOf },
        {
          environment: { DATABASE_URL: "postgresql://local-test/cpi" },
          now: () => new Date(asOf),
        },
        {
          createDatabase: () => database,
          createRepository: () => repository,
        },
      ),
    ).rejects.toThrow("database unavailable");
    expect(database.close).toHaveBeenCalledOnce();
  });
});

const asOf = "2026-09-10T15:00:00.000Z";
const counts = {
  searchRuns: 1,
  searchMemberships: 0,
  providerListings: 0,
  alertEvents: 0,
  total: 1,
};

class FakeDatabase implements SqlDatabase {
  readonly close = vi.fn(async () => {});

  async query(): Promise<SqlQueryResult> {
    return { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

class FakeRepository implements ListingRetentionRepositoryPort {
  readonly listCalls: InspectListingRetentionInput[] = [];
  readonly executeCalls: ExecuteListingRetentionInput[] = [];

  async listCandidates(
    input: InspectListingRetentionInput,
  ): Promise<readonly ListingRetentionCandidate[]> {
    this.listCalls.push(input);
    return [
      {
        recordKind: "search-run",
        recordKey: "opaque-run",
        retainedThrough: "2026-01-01T00:00:00.000Z",
      },
    ];
  }

  async execute(input: ExecuteListingRetentionInput) {
    this.executeCalls.push(input);
    return {
      mode: "execute" as const,
      asOf: input.asOf,
      startedAt: input.asOf,
      completedAt: input.asOf,
      candidates: input.expectedCandidates,
      deleted: input.expectedCandidates,
      hasMore: false,
    };
  }
}
