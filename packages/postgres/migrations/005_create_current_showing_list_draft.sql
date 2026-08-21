CREATE TABLE current_showing_list_draft (
  singleton_key text PRIMARY KEY DEFAULT 'current',
  generation_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  prompt_version text NOT NULL,
  model text NOT NULL,
  provider_response_id text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  duration_ms integer NOT NULL,
  generation_input jsonb NOT NULL,
  draft jsonb NOT NULL,
  artifact_key text NOT NULL,
  artifact_etag text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  delivery_status text NOT NULL DEFAULT 'pending',
  delivered_at timestamptz,
  generated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT current_showing_list_draft_singleton
    CHECK (singleton_key = 'current'),
  CONSTRAINT current_showing_list_draft_generation_unique
    UNIQUE (generation_id),
  CONSTRAINT current_showing_list_draft_prompt_version_bounded
    CHECK (char_length(prompt_version) BETWEEN 1 AND 64),
  CONSTRAINT current_showing_list_draft_model_bounded
    CHECK (char_length(model) BETWEEN 1 AND 200),
  CONSTRAINT current_showing_list_draft_response_id_bounded
    CHECK (
      provider_response_id IS NULL
      OR char_length(provider_response_id) BETWEEN 1 AND 200
    ),
  CONSTRAINT current_showing_list_draft_tokens_bounded
    CHECK (
      (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 10000000)
      AND (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 10000000)
      AND (total_tokens IS NULL OR total_tokens BETWEEN 0 AND 10000000)
    ),
  CONSTRAINT current_showing_list_draft_duration_bounded
    CHECK (duration_ms BETWEEN 0 AND 900000),
  CONSTRAINT current_showing_list_draft_input_object
    CHECK (jsonb_typeof(generation_input) = 'object'),
  CONSTRAINT current_showing_list_draft_result_object
    CHECK (jsonb_typeof(draft) = 'object'),
  CONSTRAINT current_showing_list_draft_artifact_key
    CHECK (artifact_key = 'showing-lists/current.pdf'),
  CONSTRAINT current_showing_list_draft_artifact_etag_bounded
    CHECK (char_length(artifact_etag) BETWEEN 1 AND 256),
  CONSTRAINT current_showing_list_draft_status
    CHECK (status IN ('draft', 'reviewed')),
  CONSTRAINT current_showing_list_draft_delivery_status
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT current_showing_list_draft_delivery_timestamp
    CHECK ((delivery_status = 'sent') = (delivered_at IS NOT NULL)),
  CONSTRAINT current_showing_list_draft_timestamp_order
    CHECK (updated_at >= generated_at)
);
