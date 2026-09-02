import { describe, expect, it } from "vitest";

import {
  applicationSecretName,
  createApplicationSecret,
} from "../lib/applicationSecret.js";

describe("createApplicationSecret", () => {
  it("resolves only stage-scoped application Secret names", () => {
    expect(applicationSecretName("dev")).toBe("cpi/dev/application");
    expect(applicationSecretName("production")).toBe(
      "cpi/production/application",
    );
  });

  it("returns only the production provider and generation values", () => {
    expect(
      createApplicationSecret({
        CPI_ALERT_EMAIL: "alerts@example.com",
        OPENAI_API_KEY: "openai-key",
        RENTCAST_API_KEY: "rentcast-key",
        SHOWING_LIST_GENERATION_CONFIG: '{"bounded":"configuration"}',
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_CHAT_ID: "telegram-chat",
      }),
    ).toEqual({
      OPENAI_API_KEY: "openai-key",
      RENTCAST_API_KEY: "rentcast-key",
      SHOWING_LIST_GENERATION_CONFIG: '{"bounded":"configuration"}',
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_CHAT_ID: "telegram-chat",
    });
  });

  it.each([
    "OPENAI_API_KEY",
    "RENTCAST_API_KEY",
    "SHOWING_LIST_GENERATION_CONFIG",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
  ])("rejects a missing %s", (variableName) => {
    expect(() =>
      createApplicationSecret({
        OPENAI_API_KEY: "openai-key",
        RENTCAST_API_KEY: "rentcast-key",
        SHOWING_LIST_GENERATION_CONFIG: '{"bounded":"configuration"}',
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_CHAT_ID: "telegram-chat",
        [variableName]: " ",
      }),
    ).toThrow(`${variableName} is required`);
  });
});
