import type { PostgresConnectionConfig } from "@chaoran-property-intelligence/postgres";

export interface ProductionConfig {
  databaseConnection: PostgresConnectionConfig;
  rentCastApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export interface ListingRefreshProviderConfig {
  rentCastApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export class ListingRefreshProviderConfigurationError extends Error {
  constructor(cause: unknown) {
    const reason =
      cause instanceof Error ? cause.message : "Unknown configuration error";
    super(`Listing refresh provider configuration was unavailable: ${reason}`, {
      cause,
    });
    this.name = "ListingRefreshProviderConfigurationError";
  }
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function loadProductionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionConfig {
  const provider = loadListingRefreshProviderConfig(environment);

  return {
    databaseConnection: loadDatabaseConnectionConfig(environment),
    ...provider,
  };
}

export function loadListingRefreshProviderConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ListingRefreshProviderConfig {
  try {
    const telegram = loadTelegramConfig(environment);
    return {
      rentCastApiKey: readRequiredVariable(environment, "RENTCAST_API_KEY"),
      telegramBotToken: telegram.botToken,
      telegramChatId: telegram.chatId,
    };
  } catch (error) {
    throw new ListingRefreshProviderConfigurationError(error);
  }
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

export function readOptionalVariable(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

export function readRequiredVariable(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
