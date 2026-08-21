import { describe, expect, it } from "vitest";

import { loadShowingListProductionConfig } from "./showingListProductionConfig.js";

const actorUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const listingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("loadShowingListProductionConfig", () => {
  it("loads one strict server-side generation configuration", () => {
    expect(loadShowingListProductionConfig(createEnvironment())).toEqual({
      databaseConnection: {
        kind: "connection-string",
        connectionString: "postgresql://database.example/app",
      },
      openAIApiKey: "openai-secret",
      telegramBotToken: "telegram-secret",
      telegramChatId: "123456789",
      artifactBucketName: "cpi-showing-list-artifacts-111111111111",
      awsAccountId: "111111111111",
      timeZone: "America/Los_Angeles",
      downloadLinkExpiresInSeconds: 900,
      generation: {
        actorUserId,
        request: {
          listingIds: [listingId],
          preferences: {
            clientDisplayName: null,
            showingDate: null,
            agentInstructions: null,
          },
        },
      },
    });
  });

  it.each([
    ["missing JSON", { SHOWING_LIST_GENERATION_CONFIG: " " }],
    ["malformed JSON", { SHOWING_LIST_GENERATION_CONFIG: "{" }],
    [
      "unknown JSON field",
      {
        SHOWING_LIST_GENERATION_CONFIG: JSON.stringify({
          ...createGenerationConfiguration(),
          systemPrompt: "not allowed",
        }),
      },
    ],
    [
      "an empty selection",
      {
        SHOWING_LIST_GENERATION_CONFIG: JSON.stringify({
          ...createGenerationConfiguration(),
          request: {
            ...createGenerationConfiguration().request,
            listingIds: [],
          },
        }),
      },
    ],
    ["an invalid bucket", { SHOWING_LIST_ARTIFACT_BUCKET: "Bad Bucket" }],
    ["a hyphenated account", { AWS_ACCOUNT_ID: "1111-1111-1111" }],
    ["an invalid time zone", { SHOWING_LIST_TIME_ZONE: "Mars/Olympus" }],
    ["an excessive TTL", { SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS: "901" }],
  ])("rejects %s without exposing configuration", (_label, override) => {
    expect(() =>
      loadShowingListProductionConfig({
        ...createEnvironment(),
        ...override,
      }),
    ).toThrow(/environment variable/iu);
  });
});

function createEnvironment(): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://database.example/app",
    OPENAI_API_KEY: "openai-secret",
    TELEGRAM_BOT_TOKEN: "telegram-secret",
    TELEGRAM_CHAT_ID: "123456789",
    SHOWING_LIST_ARTIFACT_BUCKET:
      "cpi-showing-list-artifacts-111111111111",
    AWS_ACCOUNT_ID: "111111111111",
    SHOWING_LIST_TIME_ZONE: "America/Los_Angeles",
    SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS: "900",
    SHOWING_LIST_GENERATION_CONFIG: JSON.stringify(
      createGenerationConfiguration(),
    ),
  };
}

function createGenerationConfiguration() {
  return {
    actorUserId,
    request: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: null,
        showingDate: null,
        agentInstructions: null,
      },
    },
  };
}
