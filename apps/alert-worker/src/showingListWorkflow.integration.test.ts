import { describe, expect, it } from "vitest";

import {
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  type GeneratedShowingList,
} from "@chaoran-property-intelligence/application";
import { OpenAIShowingListGenerator } from "@chaoran-property-intelligence/openai";
import { PdfKitShowingListArtifactRenderer } from "@chaoran-property-intelligence/pdf";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "@chaoran-property-intelligence/postgres";
import {
  S3ShowingListArtifactStore,
  S3ShowingListDownloadLinks,
  type S3PutObjectClient,
} from "@chaoran-property-intelligence/s3";
import { TelegramBotClient } from "@chaoran-property-intelligence/telegram";

import {
  runShowingListProduction,
  type ShowingListProductionDependencies,
} from "./runShowingListProduction.js";

const actorUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const listingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherListingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const firstRunAt = "2026-08-24T15:00:00.000Z";
const secondRunAt = "2026-08-31T15:00:00.000Z";

describe("weekly Showing List production workflow integration", () => {
  it("replaces the one current row and object, delivers after commit, and reuses a completed week", async () => {
    const harness = new ShowingListWorkflowHarness();
    harness.http.enqueueDraft(createDraft("First weekly draft"));

    await harness.run(firstRunAt);

    const firstGenerationId = harness.database.currentGenerationId;
    const firstEtag = harness.database.currentArtifactEtag;
    expect(harness.database.rowCount).toBe(1);
    expect(harness.objects.objectCount).toBe(1);
    expect(harness.objects.currentHeader).toBe("%PDF");
    expect(harness.database.currentDeliveryStatus).toBe("sent");
    expect(harness.http.telegramMessages).toHaveLength(1);
    expect(harness.events).toContain("database:replace");
    expect(harness.events.indexOf("database:replace")).toBeLessThan(
      harness.events.indexOf("telegram:send"),
    );

    harness.http.enqueueDraft(createDraft("Second weekly draft"));
    await harness.run(secondRunAt);

    expect(harness.database.rowCount).toBe(1);
    expect(harness.objects.objectCount).toBe(1);
    expect(harness.objects.keys).toEqual([SHOWING_LIST_CURRENT_ARTIFACT_KEY]);
    expect(harness.database.currentGenerationId).not.toBe(firstGenerationId);
    expect(harness.database.currentArtifactEtag).not.toBe(firstEtag);
    expect(harness.database.currentDraftTitle).toBe("Second weekly draft");
    expect(harness.database.currentPromptVersion).toBe("v1");
    expect(harness.database.currentModel).toBe("gpt-5.6-terra");
    expect(harness.database.currentTokenUsage).toEqual({
      input: 725,
      output: 410,
      total: 1_135,
    });
    expect(harness.http.openAIRequests).toHaveLength(2);
    expect(harness.http.telegramMessages).toHaveLength(2);
    expect(harness.objects.putAttempts).toBe(2);
    expect(harness.presignedKeys).toEqual([
      SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    ]);
    expect(harness.database.queries.join("\n")).not.toMatch(
      /history|DELETE\s+FROM/iu,
    );
    expect(harness.database.serializedCurrent).not.toContain("signed.example");
    expect(harness.safeOperationalEvents).not.toContain("openai-secret");
    expect(harness.safeOperationalEvents).not.toContain("telegram-secret");
    expect(harness.safeOperationalEvents).not.toContain("signed.example");

    const secondRequest = harness.http.openAIRequests[1];
    expect(secondRequest).toBeDefined();
    const requestBody = (await secondRequest!.clone().json()) as Record<
      string,
      unknown
    >;
    expect(JSON.parse(String(requestBody.input))).toMatchObject({
      untrustedContext: {
        listings: [
          {
            formattedAddress: "123 Main St, Eastvale, CA 92880",
            id: listingId,
            price: 825_000,
          },
        ],
      },
    });

    await harness.run(secondRunAt);

    expect(harness.http.openAIRequests).toHaveLength(2);
    expect(harness.objects.putAttempts).toBe(2);
    expect(harness.http.telegramMessages).toHaveLength(2);
    expect(harness.presignedKeys).toHaveLength(2);
    expect(harness.database.currentGenerationId).not.toBe(firstGenerationId);
    expect(harness.database.currentDeliveryStatus).toBe("sent");
  });

  it.each(["generation", "validation", "upload"] as const)(
    "preserves the previous current draft and skips Telegram after a %s failure",
    async (failure) => {
      const harness = new ShowingListWorkflowHarness();
      harness.http.enqueueDraft(createDraft("Usable current draft"));
      await harness.run(firstRunAt);
      const previousRow = harness.database.serializedCurrent;
      const previousObject = harness.objects.serializedCurrent;
      const previousTelegramCount = harness.http.telegramMessages.length;

      if (failure === "generation") {
        harness.http.enqueueProviderFailure(500);
      } else if (failure === "validation") {
        harness.http.enqueueDraft(
          createDraft("Invalid generated draft", otherListingId),
        );
      } else {
        harness.http.enqueueDraft(createDraft("Upload should fail"));
        harness.objects.failNextPut = true;
      }

      await expect(harness.run(secondRunAt)).rejects.toBeInstanceOf(Error);

      expect(harness.database.serializedCurrent).toBe(previousRow);
      expect(harness.objects.serializedCurrent).toBe(previousObject);
      expect(harness.database.rowCount).toBe(1);
      expect(harness.objects.objectCount).toBe(1);
      expect(harness.http.telegramMessages).toHaveLength(
        previousTelegramCount,
      );
    },
  );

  it("reconciles an ambiguous metadata commit without regenerating or reuploading", async () => {
    const harness = new ShowingListWorkflowHarness();
    harness.database.failAfterNextMetadataCommit = true;
    harness.http.enqueueDraft(createDraft("Reconciled draft"));

    await harness.run(firstRunAt);

    expect(harness.database.metadataInsertAttempts).toBe(2);
    expect(harness.database.idempotentMetadataReads).toBe(1);
    expect(harness.http.openAIRequests).toHaveLength(1);
    expect(harness.objects.putAttempts).toBe(1);
    expect(harness.http.telegramMessages).toHaveLength(1);
    expect(harness.database.currentDraftTitle).toBe("Reconciled draft");
    expect(harness.database.currentDeliveryStatus).toBe("sent");
  });

  it("keeps a published draft after bounded Telegram failure and suppresses delivery after recovery", async () => {
    const harness = new ShowingListWorkflowHarness();
    harness.http.enqueueDraft(createDraft("Published before delivery"));
    harness.http.telegramFailuresRemaining = 2;

    await expect(harness.run(firstRunAt)).rejects.toThrow(
      "Current Showing List delivery failed",
    );

    expect(harness.database.rowCount).toBe(1);
    expect(harness.objects.objectCount).toBe(1);
    expect(harness.database.currentDraftTitle).toBe(
      "Published before delivery",
    );
    expect(harness.database.currentDeliveryStatus).toBe("failed");
    expect(harness.http.telegramMessages).toHaveLength(2);
    expect(harness.http.openAIRequests).toHaveLength(1);
    expect(harness.objects.putAttempts).toBe(1);

    await harness.run(firstRunAt);

    expect(harness.database.currentDeliveryStatus).toBe("sent");
    expect(harness.http.telegramMessages).toHaveLength(3);
    expect(harness.http.openAIRequests).toHaveLength(1);
    expect(harness.objects.putAttempts).toBe(1);

    await harness.run(firstRunAt);

    expect(harness.http.telegramMessages).toHaveLength(3);
    expect(harness.http.openAIRequests).toHaveLength(1);
    expect(harness.objects.putAttempts).toBe(1);
  });

  it("rejects invalid scheduled configuration before opening storage or changing the current draft", async () => {
    const harness = new ShowingListWorkflowHarness();
    harness.http.enqueueDraft(createDraft("Existing draft"));
    await harness.run(firstRunAt);
    const previousRow = harness.database.serializedCurrent;
    const previousObject = harness.objects.serializedCurrent;
    const previousOpenCount = harness.databaseOpenCount;
    const previousTelegramCount = harness.http.telegramMessages.length;

    await expect(
      harness.run(secondRunAt, {
        SHOWING_LIST_GENERATION_CONFIG: JSON.stringify({
          actorUserId,
          request: {
            listingIds: [],
            preferences: {
              agentInstructions: null,
              clientDisplayName: null,
              showingDate: null,
            },
          },
        }),
      }),
    ).rejects.toThrow(
      "Invalid environment variable: SHOWING_LIST_GENERATION_CONFIG",
    );

    expect(harness.databaseOpenCount).toBe(previousOpenCount);
    expect(harness.database.serializedCurrent).toBe(previousRow);
    expect(harness.objects.serializedCurrent).toBe(previousObject);
    expect(harness.http.telegramMessages).toHaveLength(previousTelegramCount);
  });
});

class ShowingListWorkflowHarness {
  readonly events: string[] = [];
  readonly database = new StatefulShowingListDatabase(this.events);
  readonly http = new MockProviderHttp(this.events);
  readonly objects = new StatefulS3PutClient(this.events);
  readonly presignedKeys: string[] = [];
  databaseOpenCount = 0;

  get safeOperationalEvents(): string {
    return this.events.join("\n");
  }

  async run(
    runAt: string,
    environmentOverrides: Record<string, string> = {},
  ): Promise<void> {
    const runtimeNow = () => new Date(runAt);
    let modelClock = 1_000;
    const dependencies: ShowingListProductionDependencies = {
      createDatabase: () => {
        this.databaseOpenCount += 1;
        this.events.push("database:open");
        return this.database;
      },
      runMigrations: async () => {
        this.events.push("database:migrate");
      },
      createGenerator: (options) =>
        new OpenAIShowingListGenerator({
          ...options,
          maxRetries: 0,
          now: () => modelClock++,
        }),
      createRenderer: () =>
        new PdfKitShowingListArtifactRenderer({ compress: false }),
      createArtifactStore: (options) =>
        new S3ShowingListArtifactStore({
          ...options,
          client: this.objects,
        }),
      createDownloadLinks: (options) =>
        new S3ShowingListDownloadLinks({
          ...options,
          presign: async (command, expiresInSeconds) => {
            const key = command.input.Key;
            if (typeof key !== "string") {
              throw new Error("Expected one S3 object key");
            }
            this.events.push("s3:presign");
            this.presignedKeys.push(key);
            return `https://signed.example/${key}?signature=put-${this.objects.putAttempts}&expires=${expiresInSeconds}`;
          },
        }),
      createNotifications: (options) => new TelegramBotClient(options),
    };

    await runShowingListProduction(
      {
        environment: {
          AWS_ACCOUNT_ID: "111111111111",
          DATABASE_URL: "postgresql://database.example/app",
          OPENAI_API_KEY: "openai-secret",
          SHOWING_LIST_ARTIFACT_BUCKET:
            "cpi-showing-list-artifacts-111111111111",
          SHOWING_LIST_DOWNLOAD_URL_TTL_SECONDS: "900",
          SHOWING_LIST_GENERATION_CONFIG: JSON.stringify({
            actorUserId,
            request: {
              listingIds: [listingId],
              preferences: {
                agentInstructions: "Keep the schedule concise.",
                clientDisplayName: "Alex",
                showingDate: "2026-09-05",
              },
            },
          }),
          SHOWING_LIST_TIME_ZONE: "America/Los_Angeles",
          TELEGRAM_BOT_TOKEN: "telegram-secret",
          TELEGRAM_CHAT_ID: "123456789",
          ...environmentOverrides,
        },
        fetch: this.http.fetch,
        now: runtimeNow,
      },
      dependencies,
    );
  }
}

type ModelOutcome =
  | { draft: GeneratedShowingList; type: "draft" }
  | { status: number; type: "failure" };

class MockProviderHttp {
  readonly openAIRequests: Request[] = [];
  readonly telegramMessages: Array<Record<string, unknown>> = [];
  readonly outcomes: ModelOutcome[] = [];
  telegramFailuresRemaining = 0;

  constructor(private readonly events: string[]) {}

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);

    if (request.url === "https://api.openai.com/v1/responses") {
      this.events.push("openai:request");
      this.openAIRequests.push(request);
      const outcome = this.outcomes.shift();
      if (outcome === undefined) {
        throw new Error("Unexpected OpenAI request");
      }
      if (outcome.type === "failure") {
        return Response.json(
          {
            error: {
              code: "test_failure",
              message: "Provider detail must remain bounded",
              type: "server_error",
            },
          },
          { status: outcome.status },
        );
      }
      return Response.json(createOpenAIResponse(outcome.draft));
    }

    if (request.url.startsWith("https://api.telegram.org/")) {
      this.events.push("telegram:send");
      this.telegramMessages.push(
        (await request.json()) as Record<string, unknown>,
      );
      if (this.telegramFailuresRemaining > 0) {
        this.telegramFailuresRemaining -= 1;
        return Response.json({ ok: false }, { status: 503 });
      }
      return Response.json({ ok: true, result: {} });
    }

    throw new Error("Unexpected external request");
  };

  enqueueDraft(draft: GeneratedShowingList): void {
    this.outcomes.push({ draft, type: "draft" });
  }

  enqueueProviderFailure(status: number): void {
    this.outcomes.push({ status, type: "failure" });
  }
}

class StatefulS3PutClient implements S3PutObjectClient {
  private current:
    | { body: Uint8Array; etag: string; key: string }
    | undefined;
  failNextPut = false;
  putAttempts = 0;

  constructor(private readonly events: string[]) {}

  get objectCount(): number {
    return this.current === undefined ? 0 : 1;
  }

  get keys(): string[] {
    return this.current === undefined ? [] : [this.current.key];
  }

  get currentHeader(): string | null {
    return this.current === undefined
      ? null
      : Buffer.from(this.current.body.subarray(0, 4)).toString("ascii");
  }

  get serializedCurrent(): string {
    if (this.current === undefined) return "null";
    return JSON.stringify({
      body: Buffer.from(this.current.body).toString("base64"),
      etag: this.current.etag,
      key: this.current.key,
    });
  }

  async send(
    command: Parameters<S3PutObjectClient["send"]>[0],
  ): Promise<Awaited<ReturnType<S3PutObjectClient["send"]>>> {
    this.putAttempts += 1;
    this.events.push("s3:put");
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("Injected S3 failure");
    }

    const key = command.input.Key;
    const body = command.input.Body;
    if (typeof key !== "string" || !(body instanceof Uint8Array)) {
      throw new Error("Expected one in-memory PDF object");
    }
    const etag = `"artifact-${this.putAttempts}"`;
    this.current = {
      body: Uint8Array.from(body),
      etag,
      key,
    };
    return { $metadata: { httpStatusCode: 200 }, ETag: etag };
  }
}

class StatefulShowingListDatabase implements SqlDatabase {
  private current: Record<string, unknown> | null = null;
  readonly queries: string[] = [];
  metadataInsertAttempts = 0;
  idempotentMetadataReads = 0;
  failAfterNextMetadataCommit = false;

  constructor(private readonly events: string[]) {}

  get rowCount(): number {
    return this.current === null ? 0 : 1;
  }

  get currentGenerationId(): unknown {
    return this.current?.generation_id;
  }

  get currentArtifactEtag(): unknown {
    return this.current?.artifact_etag;
  }

  get currentDeliveryStatus(): unknown {
    return this.current?.delivery_status;
  }

  get currentDraftTitle(): unknown {
    return readRecord(this.current?.draft).title;
  }

  get currentPromptVersion(): unknown {
    return this.current?.prompt_version;
  }

  get currentModel(): unknown {
    return this.current?.model;
  }

  get currentTokenUsage(): Record<string, unknown> {
    return {
      input: this.current?.input_tokens,
      output: this.current?.output_tokens,
      total: this.current?.total_tokens,
    };
  }

  get serializedCurrent(): string {
    return JSON.stringify(this.current);
  }

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push(text);

    if (text.includes("INSERT INTO current_showing_list_draft")) {
      return this.replaceCurrent(parameters);
    }
    if (
      text.includes("generation_id = $1") &&
      text.includes("artifact_etag = $2")
    ) {
      this.idempotentMetadataReads += 1;
      const matches =
        this.current?.generation_id === parameters[0] &&
        this.current?.artifact_etag === parameters[1];
      return { rows: matches ? [this.current] : [] };
    }
    if (text.includes("delivery_status = 'sent'")) {
      return this.updateDelivery("sent", parameters);
    }
    if (text.includes("delivery_status = 'failed'")) {
      return this.updateDelivery("failed", parameters);
    }
    if (text.includes("FROM current_showing_list_draft")) {
      return { rows: this.current === null ? [] : [this.current] };
    }
    if (text.includes("FROM listings")) {
      const selectedIds = parameters[0];
      if (!Array.isArray(selectedIds)) {
        throw new Error("Expected selected listing IDs");
      }
      return {
        rows: selectedIds.includes(listingId) ? [createListingRow()] : [],
      };
    }

    throw new Error("Unexpected SQL in Showing List workflow test");
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {
    this.events.push("database:close");
  }

  private replaceCurrent(parameters: readonly unknown[]): SqlQueryResult {
    this.metadataInsertAttempts += 1;
    const generationId = parameters[0];
    if (this.current?.generation_id === generationId) {
      return { rows: [] };
    }

    this.events.push("database:replace");
    this.current = createCurrentDraftRow(parameters);
    if (this.failAfterNextMetadataCommit) {
      this.failAfterNextMetadataCommit = false;
      throw new Error("Injected ambiguous metadata result");
    }
    return { rows: [this.current] };
  }

  private updateDelivery(
    status: "failed" | "sent",
    parameters: readonly unknown[],
  ): SqlQueryResult {
    if (
      this.current === null ||
      this.current.generation_id !== parameters[0] ||
      readDate(this.current.updated_at).toISOString() !== parameters[1] ||
      this.current.delivery_status === "sent"
    ) {
      return { rows: [] };
    }

    const updatedAt = readString(parameters[2]);
    this.current = {
      ...this.current,
      delivered_at: status === "sent" ? new Date(updatedAt) : null,
      delivery_status: status,
      updated_at: new Date(updatedAt),
    };
    this.events.push(`database:delivery:${status}`);
    return { rows: [this.current] };
  }
}

function createCurrentDraftRow(
  parameters: readonly unknown[],
): Record<string, unknown> {
  const generatedAt = readString(parameters[13]);
  return {
    artifact_etag: parameters[12],
    artifact_key: parameters[11],
    created_by_user_id: parameters[1],
    delivered_at: null,
    delivery_status: "pending",
    draft: parseJson(parameters[10]),
    duration_ms: parameters[8],
    generated_at: new Date(generatedAt),
    generation_id: parameters[0],
    generation_input: parseJson(parameters[9]),
    input_tokens: parameters[5],
    model: parameters[3],
    output_tokens: parameters[6],
    prompt_version: parameters[2],
    provider_response_id: parameters[4],
    singleton_key: "current",
    status: "draft",
    total_tokens: parameters[7],
    updated_at: new Date(generatedAt),
  };
}

function createListingRow(): Record<string, unknown> {
  return {
    address_line_1: "123 Main St",
    address_line_2: null,
    bathrooms: 2.5,
    bedrooms: 4,
    city: "Eastvale",
    first_discovered_at: "2026-08-19T17:00:00.000Z",
    formatted_address: "123 Main St, Eastvale, CA 92880",
    id: listingId,
    last_seen_date: "2026-08-23",
    latitude: 33.9525,
    listed_date: "2026-08-19",
    longitude: -117.5848,
    mls_name: "CRMLS",
    mls_number: "IG26000001",
    price: 825_000,
    property_type: "Single Family",
    source: "rentcast",
    source_listing_id: "rentcast-listing-1",
    state: "CA",
    status: "Active",
    zip_code: "92880",
  };
}

function createDraft(
  title: string,
  generatedListingId = listingId,
): GeneratedShowingList {
  return {
    clientMessage: "Please review this Showing List with your agent.",
    reviewWarnings: ["Licensed-agent review is required before use."],
    stops: [
      {
        considerations: ["Confirm availability before scheduling."],
        highlights: ["Four bedrooms were provided."],
        listingId: generatedListingId,
        orderReason: "Only selected property; review the proposed order.",
        proposedOrder: 1,
      },
    ],
    summary: "An unreviewed draft based on the selected property.",
    title,
  };
}

function createOpenAIResponse(
  draft: GeneratedShowingList,
): Record<string, unknown> {
  return {
    created_at: 1_787_200_000,
    error: null,
    id: `resp_${draft.title.replaceAll(" ", "_")}`,
    incomplete_details: null,
    instructions: null,
    model: "gpt-5.6-terra",
    object: "response",
    output: [
      {
        content: [
          {
            annotations: [],
            logprobs: [],
            text: JSON.stringify(draft),
            type: "output_text",
          },
        ],
        id: "msg_showing_list",
        role: "assistant",
        status: "completed",
        type: "message",
      },
    ],
    parallel_tool_calls: true,
    status: "completed",
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 725,
      input_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      output_tokens: 410,
      output_tokens_details: { reasoning_tokens: 120 },
      total_tokens: 1_135,
    },
  };
}

function parseJson(value: unknown): unknown {
  return JSON.parse(readString(value)) as unknown;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an in-memory record");
  }
  return value as Record<string, unknown>;
}

function readDate(value: unknown): Date {
  if (!(value instanceof Date)) {
    throw new Error("Expected an in-memory date");
  }
  return value;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected an in-memory string");
  }
  return value;
}
