import {
  CheckListingAlerts,
  ListingSearchProfileUnavailableError,
  normalizeListingSearchProfile,
  type ListingAlertNotificationPort,
  type ListingAlertStateRepositoryPort,
  type ListingSearchProfileQueryPort,
  type ListingSourcePort,
} from "@chaoran-property-intelligence/application";
import {
  matchesListingAcquisitionCriteria,
  matchesNewListingCriteria,
  type ListingSearchCriteriaV1,
} from "@chaoran-property-intelligence/domain";
import {
  createPostgresDatabase,
  PostgresListingAlertRepository,
  PostgresListingSearchProfileRepository,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import {
  RentCastSaleListingsClient,
  type RentCastSaleListingsSearchCriteria,
} from "@chaoran-property-intelligence/rentcast";
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
  searchCriteria: RentCastSaleListingsSearchCriteria;
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
  createSearchProfileQuery(database) {
    return new PostgresListingSearchProfileRepository(database);
  },
  createSource(options) {
    return new RentCastListingSource({
      client: new RentCastSaleListingsClient({
        apiKey: options.apiKey,
        fetch: options.fetch,
      }),
      searchCriteria: options.searchCriteria,
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

export class UnappliedListingSearchProfileRevisionError extends Error {
  constructor() {
    super("Listing search profile revision has not been baselined");
    this.name = "UnappliedListingSearchProfileRevisionError";
  }
}

export async function runProduction(
  runtime: ProductionRuntime,
  dependencies: ProductionDependencies = defaultDependencies,
): Promise<void> {
  const config = loadProductionConfig(runtime.environment);
  const database = dependencies.createDatabase(config.databaseConnection);

  try {
    await dependencies.runMigrations(database);
    const profileQuery = dependencies.createSearchProfileQuery(database);
    const rawProfile = await profileQuery.findPrimaryProfile();
    if (rawProfile === null) {
      throw new ListingSearchProfileUnavailableError();
    }
    const profile = normalizeListingSearchProfile(rawProfile);
    if (profile.revision !== profile.appliedRevision) {
      throw new UnappliedListingSearchProfileRevisionError();
    }

    const repository = dependencies.createRepository(database);
    await repository.initializeLegacyListingAlertState();

    const checkListingAlerts = new CheckListingAlerts({
      source: dependencies.createSource({
        apiKey: config.rentCastApiKey,
        fetch: runtime.fetch,
        now: runtime.now,
        searchCriteria: projectRentCastSearchCriteria(profile.criteria),
      }),
      repository,
      notifications: dependencies.createNotifications({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        fetch: runtime.fetch,
      }),
      criteria: {
        matchesAcquisitionCriteria: (listing) =>
          matchesListingAcquisitionCriteria(listing, profile.criteria),
        matchesNewListingCriteria: (listing) =>
          matchesNewListingCriteria(listing, profile.criteria),
      },
      now: runtime.now,
    });

    await checkListingAlerts.execute();
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
