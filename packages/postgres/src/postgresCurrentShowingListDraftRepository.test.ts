import { describe, expect, it } from "vitest";

import {
  CurrentShowingListGenerationConflictError,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  type ReplaceCurrentShowingListDraftInput,
} from "@chaoran-property-intelligence/application";

import { PostgresCurrentShowingListDraftRepository } from "./postgresCurrentShowingListDraftRepository.js";
import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const listingId = "0198c7d2-7668-7775-b0fc-b789690a60c1";
const actorUserId = "0198c7d2-7668-7775-b0fc-b789690a60c2";
const generationId = "0198c7d2-7668-7775-b0fc-b789690a60c3";

describe("PostgresCurrentShowingListDraftRepository", () => {
  it("creates or replaces only the singleton current row", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [createCurrentDraftRow()] },
    ]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);
    const input = createReplacementInput();

    await expect(repository.replaceCurrentDraft(input)).resolves.toEqual(
      createExpectedCurrentDraft(),
    );

    const query = database.queries[0];
    expect(query?.text).toContain("INSERT INTO current_showing_list_draft");
    expect(query?.text).toContain("'current'");
    expect(query?.text).toContain("ON CONFLICT (singleton_key) DO UPDATE");
    expect(query?.text).toContain(
      "existing.generation_id <> EXCLUDED.generation_id",
    );
    expect(query?.text).not.toMatch(/DELETE\s+FROM/iu);
    expect(query?.parameters).toEqual([
      generationId,
      actorUserId,
      "v1",
      "gpt-5.6-terra",
      "resp_123",
      100,
      80,
      180,
      1_250,
      JSON.stringify(input.generationInput),
      JSON.stringify(input.draft),
      SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      '"artifact-etag"',
      "2026-08-20T20:00:00.000Z",
    ]);
  });

  it("loads the singleton current draft", async () => {
    const database = new RecordingSqlDatabase([
      {
        rows: [
          createCurrentDraftRow({
            status: "reviewed",
            delivery_status: "sent",
            delivered_at: new Date("2026-08-20T20:05:00.000Z"),
            updated_at: new Date("2026-08-20T20:05:00.000Z"),
          }),
        ],
      },
    ]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);

    await expect(repository.findCurrentDraft()).resolves.toMatchObject({
      generationId,
      status: "reviewed",
      deliveryStatus: "sent",
      deliveredAt: "2026-08-20T20:05:00.000Z",
    });
    expect(database.queries[0]?.text).toContain(
      "WHERE singleton_key = 'current'",
    );
    expect(database.queries[0]?.parameters).toEqual([]);
  });

  it("returns null when no current draft exists", async () => {
    const database = new RecordingSqlDatabase([{ rows: [] }]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);

    await expect(repository.findCurrentDraft()).resolves.toBeNull();
  });

  it("rejects the same generation ID with a different ETag", async () => {
    const database = new RecordingSqlDatabase([{ rows: [] }, { rows: [] }]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);

    await expect(
      repository.replaceCurrentDraft(createReplacementInput()),
    ).rejects.toThrow(CurrentShowingListGenerationConflictError);
    expect(database.queries[1]?.parameters).toEqual([
      generationId,
      '"artifact-etag"',
    ]);
  });

  it("returns an existing matching generation without resetting review state", async () => {
    const database = new RecordingSqlDatabase([
      { rows: [] },
      {
        rows: [
          createCurrentDraftRow({
            status: "reviewed",
            updated_at: new Date("2026-08-20T20:10:00.000Z"),
          }),
        ],
      },
    ]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);

    await expect(
      repository.replaceCurrentDraft(createReplacementInput()),
    ).resolves.toMatchObject({
      generationId,
      status: "reviewed",
      updatedAt: "2026-08-20T20:10:00.000Z",
    });
    expect(database.queries).toHaveLength(2);
    expect(database.queries[1]?.text).toContain("generation_id = $1");
    expect(database.queries[1]?.text).toContain("artifact_etag = $2");
  });

  it("rejects invalid input before querying PostgreSQL", async () => {
    const database = new RecordingSqlDatabase();
    const repository = new PostgresCurrentShowingListDraftRepository(database);
    const invalidInput = asUnsafeReplacement({
      ...createReplacementInput(),
      artifact: {
        key: "showing-lists/history.pdf",
        etag: '"artifact-etag"',
      },
    });

    await expect(repository.replaceCurrentDraft(invalidInput)).rejects.toThrow(
      "Current Showing List draft persistence input was invalid",
    );
    expect(database.queries).toEqual([]);
  });

  it.each([
    { singleton_key: "history" },
    { generation_input: { listingIds: [] } },
    { artifact_key: "showing-lists/history.pdf" },
    { status: "published" },
    { delivery_status: "sent", delivered_at: null },
    { input_tokens: -1 },
    { generated_at: "2026-08-20T20:00:00.000Z" },
  ])("rejects a malformed current draft row: %o", async (override) => {
    const database = new RecordingSqlDatabase([
      { rows: [createCurrentDraftRow(override)] },
    ]);
    const repository = new PostgresCurrentShowingListDraftRepository(database);

    await expect(repository.findCurrentDraft()).rejects.toThrow(
      "PostgreSQL current Showing List draft row did not match the expected schema",
    );
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class RecordingSqlDatabase implements SqlDatabase {
  readonly queries: RecordedQuery[] = [];
  transactionCount = 0;

  constructor(private readonly responses: SqlQueryResult[] = []) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    this.queries.push({ text, parameters });
    return this.responses.shift() ?? { rows: [] };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createReplacementInput(): ReplaceCurrentShowingListDraftInput {
  return {
    generationId,
    createdByUserId: actorUserId,
    promptVersion: "v1",
    generationInput: {
      listingIds: [listingId],
      preferences: {
        clientDisplayName: "Alex",
        showingDate: "2026-08-23",
        agentInstructions: null,
      },
    },
    draft: createDraft(),
    generationMetadata: {
      model: "gpt-5.6-terra",
      responseId: "resp_123",
      inputTokens: 100,
      outputTokens: 80,
      totalTokens: 180,
      durationMs: 1_250,
    },
    artifact: {
      key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      etag: '"artifact-etag"',
    },
    generatedAt: "2026-08-20T20:00:00.000Z",
  };
}

function asUnsafeReplacement(
  value: unknown,
): ReplaceCurrentShowingListDraftInput {
  return value as ReplaceCurrentShowingListDraftInput;
}

function createExpectedCurrentDraft() {
  return {
    ...createReplacementInput(),
    status: "draft" as const,
    deliveryStatus: "pending" as const,
    deliveredAt: null,
    updatedAt: "2026-08-20T20:00:00.000Z",
  };
}

function createCurrentDraftRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const input = createReplacementInput();
  return {
    singleton_key: "current",
    generation_id: generationId,
    created_by_user_id: actorUserId,
    prompt_version: "v1",
    model: "gpt-5.6-terra",
    provider_response_id: "resp_123",
    input_tokens: 100,
    output_tokens: 80,
    total_tokens: 180,
    duration_ms: 1_250,
    generation_input: input.generationInput,
    draft: input.draft,
    artifact_key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    artifact_etag: '"artifact-etag"',
    status: "draft",
    delivery_status: "pending",
    delivered_at: null,
    generated_at: new Date("2026-08-20T20:00:00.000Z"),
    updated_at: new Date("2026-08-20T20:00:00.000Z"),
    ...overrides,
  };
}

function createDraft() {
  return {
    title: "Saturday Showing List",
    summary: "An unreviewed draft for the selected properties.",
    stops: [
      {
        listingId,
        proposedOrder: 1,
        orderReason: "Suggested order for agent review.",
        highlights: ["Four bedrooms"],
        considerations: ["Confirm showing availability"],
      },
    ],
    clientMessage: "Please review these properties before the showing.",
    reviewWarnings: ["Licensed-agent review is required."],
  };
}
