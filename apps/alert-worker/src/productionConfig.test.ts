import { describe, expect, it } from "vitest";

import {
  loadDatabaseConnectionConfig,
  loadProductionConfig,
} from "./productionConfig.js";

describe("loadProductionConfig", () => {
  it("loads database-only configuration for baseline verification", () => {
    expect(
      loadDatabaseConnectionConfig({
        DATABASE_URL: "postgresql://database.example/app",
      }),
    ).toEqual({
      kind: "connection-string",
      connectionString: "postgresql://database.example/app",
    });
  });

  it("loads a local DATABASE_URL with the shared production settings", () => {
    expect(
      loadProductionConfig({
        DATABASE_URL: "postgresql://database.example/app",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      }),
    ).toEqual({
      databaseConnection: {
        kind: "connection-string",
        connectionString: "postgresql://database.example/app",
      },
      rentCastApiKey: "rentcast-secret",
      telegramBotToken: "telegram-secret",
      telegramChatId: "123456789",
    });
  });

  it("loads AWS-injected PostgreSQL parameters with verified TLS", () => {
    expect(
      loadProductionConfig({
        PGHOST: "database.cluster.example",
        PGPORT: "5432",
        PGDATABASE: "property_intelligence",
        PGUSER: "worker",
        PGPASSWORD: "database-secret",
        PGSSLMODE: "verify-full",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      }),
    ).toEqual({
      databaseConnection: {
        kind: "parameters",
        host: "database.cluster.example",
        port: 5432,
        database: "property_intelligence",
        user: "worker",
        password: "database-secret",
        ssl: true,
      },
      rentCastApiKey: "rentcast-secret",
      telegramBotToken: "telegram-secret",
      telegramChatId: "123456789",
    });
  });

  it.each(["RENTCAST_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"])(
    "rejects a missing or blank %s without exposing values",
    (missingKey) => {
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://database.example/app",
      RENTCAST_API_KEY: "rentcast-secret",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_CHAT_ID: "123456789",
      [missingKey]: "   ",
    };

    expect(() => loadProductionConfig(environment)).toThrow(
      `Missing required environment variable: ${missingKey}`,
    );
    },
  );

  it("rejects incomplete AWS database parameters", () => {
    expect(() =>
      loadProductionConfig({
        PGHOST: "database.cluster.example",
        PGPORT: "5432",
        PGDATABASE: "property_intelligence",
        PGUSER: "worker",
        PGPASSWORD: " ",
        PGSSLMODE: "verify-full",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      }),
    ).toThrow("Missing required environment variable: PGPASSWORD");
  });

  it.each(["not-a-number", "0", "65536"])(
    "rejects invalid PostgreSQL port %s",
    (port) => {
      expect(() =>
        loadProductionConfig({
          PGHOST: "database.cluster.example",
          PGPORT: port,
          PGDATABASE: "property_intelligence",
          PGUSER: "worker",
          PGPASSWORD: "database-secret",
          PGSSLMODE: "verify-full",
          RENTCAST_API_KEY: "rentcast-secret",
          TELEGRAM_BOT_TOKEN: "telegram-secret",
          TELEGRAM_CHAT_ID: "123456789",
        }),
      ).toThrow("Invalid PostgreSQL port: PGPORT");
    },
  );

  it("requires certificate-verifying TLS for parameter-based connections", () => {
    expect(() =>
      loadProductionConfig({
        PGHOST: "database.cluster.example",
        PGPORT: "5432",
        PGDATABASE: "property_intelligence",
        PGUSER: "worker",
        PGPASSWORD: "database-secret",
        PGSSLMODE: "require",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      }),
    ).toThrow("PGSSLMODE must be verify-full");
  });
});
