export interface ProductionConfig {
  databaseUrl: string;
  rentCastApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export function loadProductionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionConfig {
  return {
    databaseUrl: readRequiredVariable(environment, "DATABASE_URL"),
    rentCastApiKey: readRequiredVariable(environment, "RENTCAST_API_KEY"),
    telegramBotToken: readRequiredVariable(
      environment,
      "TELEGRAM_BOT_TOKEN",
    ),
    telegramChatId: readRequiredVariable(environment, "TELEGRAM_CHAT_ID"),
  };
}

function readRequiredVariable(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
