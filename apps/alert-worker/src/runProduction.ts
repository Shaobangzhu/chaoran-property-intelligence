import {
  CheckListingAlerts,
  type ListingAlertNotificationPort,
  type ListingAlertStateRepositoryPort,
  type ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import {
  matchesMvpSearchCriteria,
  matchesPriceAlertAcquisitionCriteria,
} from "@chaoran-property-intelligence/domain";
import {
  createPostgresDatabase,
  PostgresListingAlertRepository,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import { RentCastSaleListingsClient } from "@chaoran-property-intelligence/rentcast";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import { loadProductionConfig } from "./productionConfig.js";
import { RentCastListingSource } from "./rentCastListingSource.js";

export interface ProductionRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => Date;
}

export interface ProductionSourceOptions {
  apiKey: string;
  fetch: typeof fetch;
  now: () => Date;
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
  createSource(options) {
    return new RentCastListingSource({
      client: new RentCastSaleListingsClient({
        apiKey: options.apiKey,
        fetch: options.fetch,
      }),
      now: options.now,
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

    const checkListingAlerts = new CheckListingAlerts({
      source: dependencies.createSource({
        apiKey: config.rentCastApiKey,
        fetch: runtime.fetch,
        now: runtime.now,
      }),
      repository,
      notifications: dependencies.createNotifications({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        fetch: runtime.fetch,
      }),
      criteria: {
        matchesAcquisitionCriteria: matchesPriceAlertAcquisitionCriteria,
        matchesNewListingCriteria: matchesMvpSearchCriteria,
      },
      now: runtime.now,
    });

    await checkListingAlerts.execute();
  } finally {
    await database.close();
  }
}
