import {
  SHOWING_LIST_DOWNLOAD_LINK_LIMITS,
  safeParseShowingListGenerationInput,
  type ShowingListGenerationInput,
} from "@chaoran-property-intelligence/application";
import type { PostgresConnectionConfig } from "@chaoran-property-intelligence/postgres";

import {
  loadDatabaseConnectionConfig,
  loadTelegramConfig,
  readOptionalVariable,
  readRequiredVariable,
} from "./productionConfig.js";

const defaultDownloadLinkExpiresInSeconds = 15 * 60;
const maximumConfigurationLength = 12_000;

export interface ScheduledShowingListConfiguration {
  actorUserId: string;
  request: ShowingListGenerationInput;
}

export interface ShowingListProductionConfig {
  databaseConnection: PostgresConnectionConfig;
  openAIApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  artifactBucketName: string;
  awsAccountId: string;
  timeZone: string;
  downloadLinkExpiresInSeconds: number;
  generation: ScheduledShowingListConfiguration;
}

export function loadShowingListProductionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ShowingListProductionConfig {
  const telegram = loadTelegramConfig(environment);
  const artifactBucketName = readRequiredVariable(
    environment,
    "SHOWING_LIST_ARTIFACT_BUCKET",
  );
  if (!isBucketName(artifactBucketName)) {
    throw new Error(
      "Invalid environment variable: SHOWING_LIST_ARTIFACT_BUCKET",
    );
  }

  const awsAccountId = readRequiredVariable(environment, "AWS_ACCOUNT_ID");
  if (!/^\d{12}$/.test(awsAccountId)) {
    throw new Error("Invalid environment variable: AWS_ACCOUNT_ID");
  }

  const timeZone = readRequiredVariable(
    environment,
    "SHOWING_LIST_TIME_ZONE",
  );
  assertTimeZone(timeZone);

  return {
    databaseConnection: loadDatabaseConnectionConfig(environment),
    openAIApiKey: readRequiredVariable(environment, "OPENAI_API_KEY"),
    telegramBotToken: telegram.botToken,
    telegramChatId: telegram.chatId,
    artifactBucketName,
    awsAccountId,
    timeZone,
    downloadLinkExpiresInSeconds: readDownloadLinkExpiry(environment),
    generation: parseGenerationConfiguration(
      readRequiredVariable(environment, "SHOWING_LIST_GENERATION_CONFIG"),
    ),
  };
}

function parseGenerationConfiguration(
  serialized: string,
): ScheduledShowingListConfiguration {
  if (serialized.length > maximumConfigurationLength) {
    throw invalidGenerationConfiguration();
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw invalidGenerationConfiguration();
  }
  if (!isRecord(value) || !hasExactKeys(value, ["actorUserId", "request"])) {
    throw invalidGenerationConfiguration();
  }
  if (
    typeof value["actorUserId"] !== "string" ||
    !isUuid(value["actorUserId"])
  ) {
    throw invalidGenerationConfiguration();
  }

  const request = safeParseShowingListGenerationInput(value["request"]);
  if (!request.success) {
    throw invalidGenerationConfiguration();
  }
  return {
    actorUserId: value["actorUserId"],
    request: request.data,
  };
}

function readDownloadLinkExpiry(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const raw = readOptionalVariable(
    environment,
    "SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS",
  );
  if (raw === undefined) {
    return defaultDownloadLinkExpiresInSeconds;
  }

  const seconds = Number(raw);
  if (
    !Number.isInteger(seconds) ||
    seconds < SHOWING_LIST_DOWNLOAD_LINK_LIMITS.minimumExpiresInSeconds ||
    seconds > SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumExpiresInSeconds
  ) {
    throw new Error(
      "Invalid environment variable: SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS",
    );
  }
  return seconds;
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error("Invalid environment variable: SHOWING_LIST_TIME_ZONE");
  }
}

function isBucketName(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => keys[index] === key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidGenerationConfiguration(): Error {
  return new Error(
    "Invalid environment variable: SHOWING_LIST_GENERATION_CONFIG",
  );
}
