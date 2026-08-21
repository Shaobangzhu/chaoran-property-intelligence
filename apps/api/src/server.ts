import {
  CreateManualListing,
  GetCurrentUser,
  ListListings,
  Login,
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
  PostgresUserRepository,
  runBundledMigrations,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";

import { loadApiConfig } from "./apiConfig.js";
import { loadAuthConfig } from "./authConfig.js";
import { createApp } from "./createApp.js";

try {
  await startApi();
} catch {
  process.stderr.write("CPI API failed to start\n");
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
    const createManualListing = new CreateManualListing({
      repository: new PostgresManualListingRepository(database),
      createId: randomUUID,
      now: () => new Date(),
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
      createManualListing,
      listListings,
      login,
      getCurrentUser,
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
