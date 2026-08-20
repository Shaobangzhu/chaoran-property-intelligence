import { describe, expect, it } from "vitest";

import { createApplicationSecret } from "../lib/applicationSecret.js";

describe("createApplicationSecret", () => {
  it("returns only the three production application credentials", () => {
    expect(
      createApplicationSecret({
        CPI_ALERT_EMAIL: "alerts@example.com",
        RENTCAST_API_KEY: "rentcast-key",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_CHAT_ID: "telegram-chat",
      }),
    ).toEqual({
      RENTCAST_API_KEY: "rentcast-key",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_CHAT_ID: "telegram-chat",
    });
  });

  it.each([
    "RENTCAST_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
  ])("rejects a missing %s", (variableName) => {
    expect(() =>
      createApplicationSecret({
        RENTCAST_API_KEY: "rentcast-key",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_CHAT_ID: "telegram-chat",
        [variableName]: " ",
      }),
    ).toThrow(`${variableName} is required`);
  });
});
