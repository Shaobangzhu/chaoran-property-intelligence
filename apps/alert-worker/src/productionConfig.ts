import type { PostgresConnectionConfig } from "@chaoran-property-intelligence/postgres";

export interface ProductionConfig {
  databaseConnection: PostgresConnectionConfig;
  rentCastApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function loadProductionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionConfig {
  const telegram = loadTelegramConfig(environment);

  return {
    databaseConnection: loadDatabaseConnectionConfig(environment),
    rentCastApiKey: readRequiredVariable(environment, "RENTCAST_API_KEY"),
    telegramBotToken: telegram.botToken,
    telegramChatId: telegram.chatId,
  };
}

export function loadTelegramConfig(
  environment: Readonly<Record<string, string | undefined>>,
): TelegramConfig {
  return {
    botToken: readRequiredVariable(environment, "TELEGRAM_BOT_TOKEN"),
    chatId: readRequiredVariable(environment, "TELEGRAM_CHAT_ID"),
  };
}

export function loadDatabaseConnectionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): PostgresConnectionConfig {
  const databaseUrl = readOptionalVariable(environment, "DATABASE_URL");
  if (databaseUrl !== undefined) {
    return {
      kind: "connection-string",
      connectionString: databaseUrl,
    };
  }

  const sslMode = readRequiredVariable(environment, "PGSSLMODE");
  if (sslMode !== "verify-full") {
    throw new Error("PGSSLMODE must be verify-full");
  }

  return {
    kind: "parameters",
    host: readRequiredVariable(environment, "PGHOST"),
    port: readPostgresPort(environment),
    database: readRequiredVariable(environment, "PGDATABASE"),
    user: readRequiredVariable(environment, "PGUSER"),
    password: readRequiredVariable(environment, "PGPASSWORD"),
    ssl: true,
  };
}

function readPostgresPort(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const value = readRequiredVariable(environment, "PGPORT");
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid PostgreSQL port: PGPORT");
  }

  return port;
}

function readOptionalVariable(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value;
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
