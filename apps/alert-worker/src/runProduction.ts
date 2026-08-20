import {
  CheckNewListings,
  type ListingNotificationPort,
  type ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import { matchesMvpSearchCriteria } from "@chaoran-property-intelligence/domain";
import {
  createPostgresDatabase,
  PostgresListingRepository,
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

export interface ProductionDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  runMigrations(database: SqlDatabase): Promise<void>;
  createSource(options: ProductionSourceOptions): ListingSourcePort;
  createNotifications(
    options: ProductionNotificationOptions,
  ): ListingNotificationPort;
}

const defaultDependencies: ProductionDependencies = {
  createDatabase: createPostgresDatabase,
  runMigrations: runBundledMigrations,
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

    const checkNewListings = new CheckNewListings({
      source: dependencies.createSource({
        apiKey: config.rentCastApiKey,
        fetch: runtime.fetch,
        now: runtime.now,
      }),
      repository: new PostgresListingRepository(database),
      notifications: dependencies.createNotifications({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        fetch: runtime.fetch,
      }),
      criteria: {
        matchesSearchCriteria: matchesMvpSearchCriteria,
      },
    });

    await checkNewListings.execute();
  } finally {
    await database.close();
  }
}
