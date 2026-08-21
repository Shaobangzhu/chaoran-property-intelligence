import {
  ArchiveManualListing,
  CreateManualListing,
  GetCurrentShowingListArtifact,
  GetCurrentShowingListDraft,
  GetCurrentUser,
  ListListings,
  Login,
  MarkCurrentShowingListDraftReviewed,
  SaveCurrentShowingListDraft,
  ShowingListArtifactReaderUnavailableError,
  type ShowingListArtifactReaderPort,
  UpdateManualListing,
} from "@chaoran-property-intelligence/application";
import {
  Argon2idPasswordHasher,
  DUMMY_PASSWORD_HASH,
  JoseAccessTokenService,
} from "@chaoran-property-intelligence/auth";
import {
  createPostgresDatabase,
  PostgresListingQuery,
  PostgresManualListingRepository,
  PostgresCurrentShowingListDraftRepository,
  PostgresUserRepository,
  runBundledMigrations,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import { S3ShowingListArtifactReader } from "@chaoran-property-intelligence/s3";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";

import { loadApiConfig } from "./apiConfig.js";
import { loadAuthConfig } from "./authConfig.js";
import { createApp } from "./createApp.js";

class UnconfiguredShowingListArtifactReader
  implements ShowingListArtifactReaderPort
{
  async readCurrentArtifact(): Promise<never> {
    throw new ShowingListArtifactReaderUnavailableError();
  }
}

try {
  await startApi();
} catch (error) {
  process.stderr.write("CPI API failed to start\n");
  if (process.env.API_DEPLOYMENT_MODE !== "production") {
    process.stderr.write(
      `Local startup error: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
  }
  process.exitCode = 1;
}

async function startApi(): Promise<void> {
  const config = loadApiConfig(process.env);
  const authConfig = loadAuthConfig(process.env);
  const database = createPostgresDatabase(config.databaseConnection, {
    applicationName: "chaoran-property-api",
  });

  try {
    await runBundledMigrations(database);

    const listListings = new ListListings({
      query: new PostgresListingQuery(database),
    });
    const manualListingRepository = new PostgresManualListingRepository(database);
    const createManualListing = new CreateManualListing({
      repository: manualListingRepository,
      createId: randomUUID,
      now: () => new Date(),
    });
    const updateManualListing = new UpdateManualListing({
      repository: manualListingRepository,
      now: () => new Date(),
    });
    const archiveManualListing = new ArchiveManualListing({
      repository: manualListingRepository,
      now: () => new Date(),
    });
    const showingListRepository =
      new PostgresCurrentShowingListDraftRepository(database);
    const getCurrentShowingListDraft = new GetCurrentShowingListDraft(
      showingListRepository,
    );
    const saveCurrentShowingListDraft = new SaveCurrentShowingListDraft({
      now: () => new Date(),
      repository: showingListRepository,
    });
    const markCurrentShowingListDraftReviewed =
      new MarkCurrentShowingListDraftReviewed({
        now: () => new Date(),
        repository: showingListRepository,
      });
    const getCurrentShowingListArtifact = new GetCurrentShowingListArtifact({
      reader:
        config.showingListArtifactStorage === null
          ? new UnconfiguredShowingListArtifactReader()
          : new S3ShowingListArtifactReader({
              bucketName: config.showingListArtifactStorage.bucketName,
              expectedBucketOwner:
                config.showingListArtifactStorage.expectedBucketOwner,
            }),
      repository: showingListRepository,
    });
    const userRepository = new PostgresUserRepository(database);
    const tokenService = new JoseAccessTokenService(authConfig);
    const login = new Login({
      repository: userRepository,
      passwordHasher: new Argon2idPasswordHasher(),
      tokenService,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
    });
    const getCurrentUser = new GetCurrentUser({
      repository: userRepository,
      tokenService,
    });
    const app = createApp({
      archiveManualListing,
      createManualListing,
      listListings,
      login,
      getCurrentUser,
      getCurrentShowingListArtifact,
      getCurrentShowingListDraft,
      httpSecurity: {
        deploymentMode: config.deploymentMode,
        publicOrigin: config.publicOrigin,
        originVerificationSecret: config.originVerificationSecret,
      },
      logger: {
        error(event, context) {
          process.stderr.write(`${JSON.stringify({ event, ...context })}\n`);
        },
        info(event, context) {
          process.stdout.write(`${JSON.stringify({ event, ...context })}\n`);
        },
      },
      markCurrentShowingListDraftReviewed,
      saveCurrentShowingListDraft,
      updateManualListing,
    });
    const server = app.listen(config.port, config.host);
    await once(server, "listening");

    process.stdout.write(
      `CPI API listening on http://${config.host}:${config.port}\n`,
    );
    registerShutdown(server, database);
  } catch (error) {
    await database.close();
    throw error;
  }
}

function registerShutdown(server: Server, database: SqlDatabase): void {
  let shutdownRequested = false;
  const requestShutdown = (): void => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    void closeApi(server, database);
  };

  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
}

async function closeApi(server: Server, database: SqlDatabase): Promise<void> {
  let closeFailed = false;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  } catch {
    closeFailed = true;
  }

  try {
    await database.close();
  } catch {
    closeFailed = true;
  }

  if (closeFailed) {
    process.stderr.write("CPI API failed to shut down cleanly\n");
    process.exitCode = 1;
  }
}
