import { describe, expect, it } from "vitest";

import { loadProductionConfig } from "./productionConfig.js";

describe("loadProductionConfig", () => {
  it("loads all required production settings", () => {
    expect(
      loadProductionConfig({
        DATABASE_URL: "postgresql://database.example/app",
        RENTCAST_API_KEY: "rentcast-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "123456789",
      }),
    ).toEqual({
      databaseUrl: "postgresql://database.example/app",
      rentCastApiKey: "rentcast-secret",
      telegramBotToken: "telegram-secret",
      telegramChatId: "123456789",
    });
  });

  it.each([
    "DATABASE_URL",
    "RENTCAST_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
  ])("rejects a missing or blank %s without exposing values", (missingKey) => {
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
  });
});
