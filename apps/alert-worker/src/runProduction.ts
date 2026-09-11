import {
  ReconcileListingRefresh,
  type ListingAlertNotificationPort,
  type ListingAlertStateRepositoryPort,
  type ListingRefreshRunRepositoryPort,
  type ListingSearchProfileQueryPort,
  type ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import type { ListingSearchCriteriaV1 } from "@chaoran-property-intelligence/domain";
import {
  createPostgresDatabase,
  PostgresListingAlertRepository,
  PostgresListingRefreshRunRepository,
  PostgresListingSearchProfileRepository,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import {
  RentCastSaleListingsClient,
  type RentCastSaleListingsSearchArea,
  type RentCastSaleListingsSearchCriteria,
} from "@chaoran-property-intelligence/rentcast";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";
import { randomUUID } from "node:crypto";

import {
  loadProductionConfig,
  readOptionalVariable,
} from "./productionConfig.js";
import { RentCastListingSource } from "./rentCastListingSource.js";
import { selectRentCastSaleListingsSearchAreas } from "./rentCastSearchAreas.js";

export interface ProductionRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => Date;
  createId?: () => string;
}

export interface ProductionSourceOptions {
  apiKey: string;
  fetch: typeof fetch;
  now: () => Date;
  searchAreas: readonly RentCastSaleListingsSearchArea[];
  searchCriteria: RentCastSaleListingsSearchCriteria;
  onProviderRequest: () => void;
  onProviderResponse: (returnedListingCount: number) => void;
}

export interface ProductionNotificationOptions {
  botToken: string;
  chatId: string;
  fetch: typeof fetch;
}

export interface ProductionListingAlertRepository
  extends ListingAlertStateRepositoryPort {
  initializeLegacyListingAlertState(): Promise<void>;
}

export interface ProductionDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  runMigrations(database: SqlDatabase): Promise<void>;
  createRepository(database: SqlDatabase): ProductionListingAlertRepository;
  createRefreshRunRepository(
    database: SqlDatabase,
  ): ListingRefreshRunRepositoryPort;
  createSearchProfileQuery(
    database: SqlDatabase,
  ): ListingSearchProfileQueryPort;
  createSource(options: ProductionSourceOptions): ListingSourcePort;
  createNotifications(
    options: ProductionNotificationOptions,
  ): ListingAlertNotificationPort;
}

const defaultDependencies: ProductionDependencies = {
  createDatabase: createPostgresDatabase,
  runMigrations: runBundledMigrations,
  createRepository(database) {
    return new PostgresListingAlertRepository(database);
  },
  createRefreshRunRepository(database) {
    return new PostgresListingRefreshRunRepository(database);
  },
  createSearchProfileQuery(database) {
    return new PostgresListingSearchProfileRepository(database);
  },
  createSource(options) {
    return new RentCastListingSource({
      client: new RentCastSaleListingsClient({
        apiKey: options.apiKey,
        fetch: options.fetch,
      }),
      searchAreas: options.searchAreas,
      searchCriteria: options.searchCriteria,
      now: options.now,
      onProviderRequest: options.onProviderRequest,
      onProviderResponse: options.onProviderResponse,
    });
  },
  createNotifications(options) {
    return new TelegramBotClient({
      botToken: options.botToken,
      chatId: options.chatId,
      fetch: options.fetch,
    });
  },
};

export async function runProduction(
  runtime: ProductionRuntime,
  dependencies: ProductionDependencies = defaultDependencies,
): Promise<void> {
  const config = loadProductionConfig(runtime.environment);
  const database = dependencies.createDatabase(config.databaseConnection);

  try {
    await dependencies.runMigrations(database);
    const repository = dependencies.createRepository(database);
    await repository.initializeLegacyListingAlertState();
    const reconcile = new ReconcileListingRefresh({
      alertRepository: repository,
      createId: runtime.createId ?? randomUUID,
      now: runtime.now,
      notifications: dependencies.createNotifications({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        fetch: runtime.fetch,
      }),
      profileQuery: dependencies.createSearchProfileQuery(database),
      runRepository: dependencies.createRefreshRunRepository(database),
      sourceFactory: {
        create(input) {
          return dependencies.createSource({
            apiKey: config.rentCastApiKey,
            fetch: runtime.fetch,
            now: runtime.now,
            searchAreas: selectRentCastSaleListingsSearchAreas(
              input.criteria.cities,
            ),
            searchCriteria: projectRentCastSearchCriteria(input.criteria),
            onProviderRequest: input.onProviderRequest,
            onProviderResponse: input.onProviderResponse,
          });
        },
      },
    });
    await reconcile.execute({
      signaledRunId:
        readOptionalVariable(runtime.environment, "LISTING_REFRESH_RUN_ID") ??
        null,
    });
  } finally {
    await database.close();
  }
}

function projectRentCastSearchCriteria(
  criteria: ListingSearchCriteriaV1,
): RentCastSaleListingsSearchCriteria {
  return Object.freeze({
    propertyType: criteria.propertyType,
    maximumPrice: criteria.maximumPrice,
    minimumBedrooms: criteria.minimumBedrooms,
    minimumBathrooms: criteria.minimumBathrooms,
  });
}
