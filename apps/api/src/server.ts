import { ListListings } from "@chaoran-property-intelligence/application";
import {
  createPostgresDatabase,
  PostgresListingQuery,
  runBundledMigrations,
  type SqlDatabase,
} from "@chaoran-property-intelligence/postgres";
import { once } from "node:events";
import type { Server } from "node:http";

import { loadApiConfig } from "./apiConfig.js";
import { createApp } from "./createApp.js";

try {
  await startApi();
} catch {
  process.stderr.write("CPI API failed to start\n");
  process.exitCode = 1;
}

async function startApi(): Promise<void> {
  const config = loadApiConfig(process.env);
  const database = createPostgresDatabase(config.databaseConnection, {
    applicationName: "chaoran-property-api",
  });

  try {
    await runBundledMigrations(database);

    const listListings = new ListListings({
      query: new PostgresListingQuery(database),
    });
    const app = createApp({
      listListings,
      logger: {
        error(message) {
          process.stderr.write(`${message}\n`);
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
