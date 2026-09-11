import {
  ExecuteListingRetention,
  PreviewListingRetention,
  type ListingRetentionAggregateCounts,
  type ListingRetentionReport,
  type ListingRetentionRepositoryPort,
} from "@chaoran-property-intelligence/application";
import {
  createPostgresDatabase,
  PostgresListingRetentionRepository,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";

import { loadListingRetentionPolicy } from "./listingRetentionConfig.js";
import { loadDatabaseConnectionConfig } from "./productionConfig.js";

export type ListingRetentionRequest =
  | {
      readonly mode: "preview";
      readonly asOf?: string;
    }
  | {
      readonly mode: "execute";
      readonly asOf: string;
      readonly expectedCandidates: ListingRetentionAggregateCounts;
    };

export interface ListingRetentionRuntime {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
}

export interface ListingRetentionDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  createRepository(database: SqlDatabase): ListingRetentionRepositoryPort;
}

const defaultDependencies: ListingRetentionDependencies = {
  createDatabase(connection) {
    return createPostgresDatabase(connection, {
      applicationName: "chaoran-property-listing-retention",
    });
  },
  createRepository(database) {
    return new PostgresListingRetentionRepository(database);
  },
};

export async function runListingRetention(
  request: ListingRetentionRequest,
  runtime: ListingRetentionRuntime,
  dependencies: ListingRetentionDependencies = defaultDependencies,
): Promise<ListingRetentionReport> {
  const policy = loadListingRetentionPolicy(runtime.environment);
  const database = dependencies.createDatabase(
    loadDatabaseConnectionConfig(runtime.environment),
  );

  try {
    const repository = dependencies.createRepository(database);
    if (request.mode === "preview") {
      const asOf = request.asOf ?? readClock(runtime.now);
      return new PreviewListingRetention({
        repository,
        now: runtime.now,
      }).execute({ asOf, policy });
    }

    return new ExecuteListingRetention({ repository }).execute({
      asOf: request.asOf,
      policy,
      expectedCandidates: request.expectedCandidates,
    });
  } finally {
    await database.close();
  }
}

function readClock(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Listing retention clock was invalid");
  }
  return value.toISOString();
}
