import {
  CurrentShowingListGenerationConflictError,
  safeParseCurrentShowingListDraft,
  safeParseMarkCurrentShowingListDraftReviewedInput,
  safeParseReplaceCurrentShowingListDraftInput,
  safeParseSaveCurrentShowingListDraftInput,
  type CurrentShowingListDraft,
  type CurrentShowingListDraftRepositoryPort,
  type CurrentShowingListDraftReviewRepositoryPort,
  type MarkCurrentShowingListDraftReviewedPersistenceInput,
  type ReplaceCurrentShowingListDraftInput,
  type SaveCurrentShowingListDraftPersistenceInput,
} from "@chaoran-property-intelligence/application";

import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

const currentDraftColumns = `
  singleton_key,
  generation_id,
  created_by_user_id,
  prompt_version,
  model,
  provider_response_id,
  input_tokens,
  output_tokens,
  total_tokens,
  duration_ms,
  generation_input,
  draft,
  artifact_key,
  artifact_etag,
  status,
  delivery_status,
  delivered_at,
  generated_at,
  updated_at
`;

const replaceCurrentDraftSql = `
  INSERT INTO current_showing_list_draft AS existing (${currentDraftColumns})
  VALUES (
    'current', $1, $2, $3, $4, $5, $6, $7, $8, $9,
    $10::jsonb, $11::jsonb, $12, $13, 'draft', 'pending', NULL, $14, $14
  )
  ON CONFLICT (singleton_key) DO UPDATE
  SET
    generation_id = EXCLUDED.generation_id,
    created_by_user_id = EXCLUDED.created_by_user_id,
    prompt_version = EXCLUDED.prompt_version,
    model = EXCLUDED.model,
    provider_response_id = EXCLUDED.provider_response_id,
    input_tokens = EXCLUDED.input_tokens,
    output_tokens = EXCLUDED.output_tokens,
    total_tokens = EXCLUDED.total_tokens,
    duration_ms = EXCLUDED.duration_ms,
    generation_input = EXCLUDED.generation_input,
    draft = EXCLUDED.draft,
    artifact_key = EXCLUDED.artifact_key,
    artifact_etag = EXCLUDED.artifact_etag,
    status = EXCLUDED.status,
    delivery_status = EXCLUDED.delivery_status,
    delivered_at = EXCLUDED.delivered_at,
    generated_at = EXCLUDED.generated_at,
    updated_at = EXCLUDED.updated_at
  WHERE existing.generation_id <> EXCLUDED.generation_id
  RETURNING ${currentDraftColumns}
`;

const selectIdempotentCurrentDraftSql = `
  SELECT ${currentDraftColumns}
  FROM current_showing_list_draft
  WHERE singleton_key = 'current'
    AND generation_id = $1
    AND artifact_etag = $2
  LIMIT 1
`;

const saveCurrentDraftSql = `
  UPDATE current_showing_list_draft
  SET
    draft = $3::jsonb,
    status = 'draft',
    updated_at = $4
  WHERE singleton_key = 'current'
    AND generation_id = $1
    AND updated_at = $2
  RETURNING ${currentDraftColumns}
`;

const markCurrentDraftReviewedSql = `
  UPDATE current_showing_list_draft
  SET
    status = 'reviewed',
    updated_at = $3
  WHERE singleton_key = 'current'
    AND generation_id = $1
    AND updated_at = $2
  RETURNING ${currentDraftColumns}
`;

export class PostgresCurrentShowingListDraftRepository
  implements
    CurrentShowingListDraftRepositoryPort,
    CurrentShowingListDraftReviewRepositoryPort
{
  constructor(private readonly database: SqlDatabase) {}

  async findCurrentDraft(): Promise<CurrentShowingListDraft | null> {
    const result = await this.database.query(
      `SELECT ${currentDraftColumns}
       FROM current_showing_list_draft
       WHERE singleton_key = 'current'
       LIMIT 1`,
    );

    if (result.rows.length === 0) {
      return null;
    }
    return parseRequiredCurrentDraft(result);
  }

  async replaceCurrentDraft(
    input: ReplaceCurrentShowingListDraftInput,
  ): Promise<CurrentShowingListDraft> {
    const parsedInput = safeParseReplaceCurrentShowingListDraftInput(input);
    if (!parsedInput.success) {
      throw new Error(
        "Current Showing List draft persistence input was invalid",
      );
    }

    const replacement = parsedInput.data;
    const metadata = replacement.generationMetadata;
    return this.database.transaction(async (connection) => {
      const result = await replaceCurrentDraft(
        connection,
        replacement,
        metadata,
      );
      if (result.rows.length > 0) {
        return parseRequiredCurrentDraft(result);
      }

      const idempotentResult = await connection.query(
        selectIdempotentCurrentDraftSql,
        [replacement.generationId, replacement.artifact.etag],
      );
      if (idempotentResult.rows.length === 0) {
        throw new CurrentShowingListGenerationConflictError();
      }
      return parseRequiredCurrentDraft(idempotentResult);
    });
  }

  async saveCurrentDraft(
    input: SaveCurrentShowingListDraftPersistenceInput,
  ): Promise<CurrentShowingListDraft | null> {
    const parsedInput = safeParseSaveCurrentShowingListDraftInput(input);
    if (!parsedInput.success) {
      throw new Error(
        "Current Showing List draft review persistence input was invalid",
      );
    }

    const result = await this.database.query(saveCurrentDraftSql, [
      parsedInput.data.generationId,
      parsedInput.data.expectedUpdatedAt,
      JSON.stringify(parsedInput.data.draft),
      parsedInput.data.updatedAt,
    ]);
    return parseOptionalCurrentDraft(result);
  }

  async markCurrentDraftReviewed(
    input: MarkCurrentShowingListDraftReviewedPersistenceInput,
  ): Promise<CurrentShowingListDraft | null> {
    const parsedInput = safeParseMarkCurrentShowingListDraftReviewedInput(input);
    if (!parsedInput.success) {
      throw new Error(
        "Current Showing List draft review persistence input was invalid",
      );
    }

    const result = await this.database.query(markCurrentDraftReviewedSql, [
      parsedInput.data.generationId,
      parsedInput.data.expectedUpdatedAt,
      parsedInput.data.updatedAt,
    ]);
    return parseOptionalCurrentDraft(result);
  }
}

function replaceCurrentDraft(
  connection: SqlConnection,
  replacement: ReplaceCurrentShowingListDraftInput,
  metadata: ReplaceCurrentShowingListDraftInput["generationMetadata"],
): Promise<SqlQueryResult> {
  return connection.query(replaceCurrentDraftSql, [
    replacement.generationId,
    replacement.createdByUserId,
    replacement.promptVersion,
    metadata.model,
    metadata.responseId,
    metadata.inputTokens,
    metadata.outputTokens,
    metadata.totalTokens,
    metadata.durationMs,
    JSON.stringify(replacement.generationInput),
    JSON.stringify(replacement.draft),
    replacement.artifact.key,
    replacement.artifact.etag,
    replacement.generatedAt,
  ]);
}

function parseRequiredCurrentDraft(
  result: SqlQueryResult,
): CurrentShowingListDraft {
  if (result.rows.length !== 1) {
    return throwInvalidCurrentDraftRowError();
  }

  const row = readRecord(result.rows[0]);
  if (row.singleton_key !== "current") {
    return throwInvalidCurrentDraftRowError();
  }

  const parsed = safeParseCurrentShowingListDraft({
    generationId: row.generation_id,
    createdByUserId: row.created_by_user_id,
    promptVersion: row.prompt_version,
    generationInput: row.generation_input,
    draft: row.draft,
    generationMetadata: {
      model: row.model,
      responseId: row.provider_response_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      durationMs: row.duration_ms,
    },
    artifact: {
      key: row.artifact_key,
      etag: row.artifact_etag,
    },
    status: row.status,
    deliveryStatus: row.delivery_status,
    deliveredAt: readNullableTimestamp(row, "delivered_at"),
    generatedAt: readTimestamp(row, "generated_at"),
    updatedAt: readTimestamp(row, "updated_at"),
  });

  if (!parsed.success) {
    return throwInvalidCurrentDraftRowError();
  }
  return parsed.data;
}

function parseOptionalCurrentDraft(
  result: SqlQueryResult,
): CurrentShowingListDraft | null {
  return result.rows.length === 0 ? null : parseRequiredCurrentDraft(result);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return throwInvalidCurrentDraftRowError();
  }
  return value as Record<string, unknown>;
}

function readTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return throwInvalidCurrentDraftRowError();
  }
  return value.toISOString();
}

function readNullableTimestamp(
  row: Record<string, unknown>,
  key: string,
): string | null {
  return row[key] === null ? null : readTimestamp(row, key);
}

function throwInvalidCurrentDraftRowError(): never {
  throw new Error(
    "PostgreSQL current Showing List draft row did not match the expected schema",
  );
}
