import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import { loadTelegramConfig } from "./productionConfig.js";

export interface TelegramSmokeTestRuntime {
  environment: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
}

export async function runTelegramSmokeTest(
  runtime: TelegramSmokeTestRuntime,
): Promise<void> {
  const config = loadTelegramConfig(runtime.environment);
  const client = new TelegramBotClient({
    botToken: config.botToken,
    chatId: config.chatId,
    fetch: runtime.fetch,
  });

  await client.sendProductionSmokeTest();
}
