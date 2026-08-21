import {
  DeliverCurrentShowingListDraft,
  GenerateShowingListDraft,
  PublishCurrentShowingListDraft,
  RunWeeklyShowingListDraft,
  type ShowingListArtifactRendererPort,
  type ShowingListArtifactStorePort,
  type ShowingListDownloadLinkPort,
  type ShowingListDraftNotificationPort,
  type ShowingListGenerator,
} from "@chaoran-property-intelligence/application";
import { OpenAIShowingListGenerator } from "@chaoran-property-intelligence/openai";
import { PdfKitShowingListArtifactRenderer } from "@chaoran-property-intelligence/pdf";
import {
  createPostgresDatabase,
  PostgresCurrentShowingListDraftRepository,
  PostgresListingQuery,
  runBundledMigrations,
  type PostgresConnectionConfig,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import {
  S3ShowingListArtifactStore,
  S3ShowingListDownloadLinks,
} from "@chaoran-property-intelligence/s3";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import { loadShowingListProductionConfig } from "./showingListProductionConfig.js";
import { createWeeklyShowingListGenerationId } from "./weeklyShowingListIdentity.js";

export interface ShowingListProductionRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => Date;
}

export interface ShowingListProductionDependencies {
  createDatabase(connection: PostgresConnectionConfig): SqlDatabase;
  runMigrations(database: SqlDatabase): Promise<void>;
  createGenerator(options: {
    apiKey: string;
    fetch: typeof fetch;
  }): ShowingListGenerator;
  createRenderer(): ShowingListArtifactRendererPort;
  createArtifactStore(options: {
    bucketName: string;
    expectedBucketOwner: string;
  }): ShowingListArtifactStorePort;
  createDownloadLinks(options: {
    bucketName: string;
    now: () => Date;
  }): ShowingListDownloadLinkPort;
  createNotifications(options: {
    botToken: string;
    chatId: string;
    fetch: typeof fetch;
  }): ShowingListDraftNotificationPort;
}

const defaultDependencies: ShowingListProductionDependencies = {
  createDatabase(connection) {
    return createPostgresDatabase(connection, {
      applicationName: "chaoran-showing-list-worker",
    });
  },
  runMigrations: runBundledMigrations,
  createGenerator(options) {
    return new OpenAIShowingListGenerator(options);
  },
  createRenderer() {
    return new PdfKitShowingListArtifactRenderer();
  },
  createArtifactStore(options) {
    return new S3ShowingListArtifactStore(options);
  },
  createDownloadLinks(options) {
    return new S3ShowingListDownloadLinks(options);
  },
  createNotifications(options) {
    return new TelegramBotClient(options);
  },
};

export async function runShowingListProduction(
  runtime: ShowingListProductionRuntime,
  dependencies: ShowingListProductionDependencies = defaultDependencies,
): Promise<void> {
  const config = loadShowingListProductionConfig(runtime.environment);
  const runAt = runtime.now();
  const generationId = createWeeklyShowingListGenerationId({
    now: runAt,
    timeZone: config.timeZone,
    generation: config.generation,
  });
  const database = dependencies.createDatabase(config.databaseConnection);

  try {
    await dependencies.runMigrations(database);
    const repository = new PostgresCurrentShowingListDraftRepository(database);
    const weeklyRun = new RunWeeklyShowingListDraft({
      currentDrafts: repository,
      preparer: new GenerateShowingListDraft({
        query: new PostgresListingQuery(database),
        generator: dependencies.createGenerator({
          apiKey: config.openAIApiKey,
          fetch: runtime.fetch,
        }),
      }),
      publisher: new PublishCurrentShowingListDraft({
        renderer: dependencies.createRenderer(),
        artifactStore: dependencies.createArtifactStore({
          bucketName: config.artifactBucketName,
          expectedBucketOwner: config.awsAccountId,
        }),
        repository,
      }),
      delivery: new DeliverCurrentShowingListDraft({
        repository,
        downloadLinks: dependencies.createDownloadLinks({
          bucketName: config.artifactBucketName,
          now: runtime.now,
        }),
        notifications: dependencies.createNotifications({
          botToken: config.telegramBotToken,
          chatId: config.telegramChatId,
          fetch: runtime.fetch,
        }),
        expiresInSeconds: config.downloadLinkExpiresInSeconds,
        maximumAttempts: 2,
        now: runtime.now,
      }),
    });

    await weeklyRun.execute({
      generationId,
      actorUserId: config.generation.actorUserId,
      generatedAt: runAt.toISOString(),
      request: config.generation.request,
    });
  } finally {
    await database.close();
  }
}
