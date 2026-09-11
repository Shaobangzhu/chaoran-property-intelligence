CREATE TABLE listing_search_runs (
  run_id uuid PRIMARY KEY,
  profile_key text NOT NULL
    REFERENCES listing_search_profiles (profile_key) ON DELETE RESTRICT,
  requested_revision bigint NOT NULL,
  effective_revision bigint,
  trigger_reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  claim_token uuid,
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  selected_markets jsonb NOT NULL,
  selected_market_count smallint NOT NULL,
  planned_provider_request_count smallint NOT NULL,
  actual_provider_request_count smallint NOT NULL DEFAULT 0,
  returned_listing_count integer NOT NULL DEFAULT 0,
  published_current_count integer NOT NULL DEFAULT 0,
  failure_code text,
  superseded_by_run_id uuid
    REFERENCES listing_search_runs (run_id) ON DELETE RESTRICT,
  CONSTRAINT listing_search_runs_revision_check
    CHECK (
      requested_revision BETWEEN 1 AND 9007199254740991
      AND (
        effective_revision IS NULL
        OR effective_revision BETWEEN 1 AND 9007199254740991
      )
    ),
  CONSTRAINT listing_search_runs_trigger_reason_check
    CHECK (
      trigger_reason IN ('criteria-change', 'scheduled', 'manual-retry')
    ),
  CONSTRAINT listing_search_runs_status_check
    CHECK (
      status IN ('queued', 'running', 'succeeded', 'failed', 'superseded')
    ),
  CONSTRAINT listing_search_runs_selected_markets_check
    CHECK (
      jsonb_typeof(selected_markets) = 'array'
      AND jsonb_array_length(selected_markets) BETWEEN 1 AND 7
      AND selected_markets <@ '[
        "Chino",
        "Chino Hills",
        "Eastvale",
        "Corona",
        "Jurupa Valley",
        "Stevenson Ranch",
        "Irvine"
      ]'::jsonb
      AND selected_market_count = jsonb_array_length(selected_markets)
      AND selected_market_count =
        (selected_markets ? 'Chino')::integer
        + (selected_markets ? 'Chino Hills')::integer
        + (selected_markets ? 'Eastvale')::integer
        + (selected_markets ? 'Corona')::integer
        + (selected_markets ? 'Jurupa Valley')::integer
        + (selected_markets ? 'Stevenson Ranch')::integer
        + (selected_markets ? 'Irvine')::integer
      AND planned_provider_request_count = selected_market_count
    ),
  CONSTRAINT listing_search_runs_request_counts_check
    CHECK (
      selected_market_count BETWEEN 1 AND 7
      AND planned_provider_request_count BETWEEN 1 AND 7
      AND actual_provider_request_count
        BETWEEN 0 AND planned_provider_request_count
    ),
  CONSTRAINT listing_search_runs_listing_counts_check
    CHECK (
      returned_listing_count BETWEEN 0 AND 3500
      AND published_current_count BETWEEN 0 AND returned_listing_count
    ),
  CONSTRAINT listing_search_runs_failure_code_check
    CHECK (
      failure_code IS NULL
      OR (
        char_length(failure_code) BETWEEN 1 AND 80
        AND failure_code ~ '^[a-z0-9][a-z0-9._-]*$'
      )
    ),
  CONSTRAINT listing_search_runs_timestamps_check
    CHECK (
      (started_at IS NULL OR started_at >= requested_at)
      AND (
        completed_at IS NULL
        OR completed_at >= COALESCE(started_at, requested_at)
      )
    ),
  CONSTRAINT listing_search_runs_state_shape_check
    CHECK (
      (
        status = 'queued'
        AND effective_revision IS NULL
        AND claim_token IS NULL
        AND started_at IS NULL
        AND completed_at IS NULL
        AND actual_provider_request_count = 0
        AND returned_listing_count = 0
        AND published_current_count = 0
        AND failure_code IS NULL
        AND superseded_by_run_id IS NULL
      )
      OR (
        status = 'running'
        AND effective_revision IS NOT NULL
        AND claim_token IS NOT NULL
        AND started_at IS NOT NULL
        AND completed_at IS NULL
        AND published_current_count = 0
        AND failure_code IS NULL
        AND superseded_by_run_id IS NULL
      )
      OR (
        status = 'succeeded'
        AND effective_revision IS NOT NULL
        AND claim_token IS NOT NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND actual_provider_request_count = planned_provider_request_count
        AND failure_code IS NULL
        AND superseded_by_run_id IS NULL
      )
      OR (
        status = 'failed'
        AND completed_at IS NOT NULL
        AND published_current_count = 0
        AND failure_code IS NOT NULL
        AND superseded_by_run_id IS NULL
        AND (
          (
            effective_revision IS NULL
            AND claim_token IS NULL
            AND started_at IS NULL
            AND actual_provider_request_count = 0
            AND returned_listing_count = 0
          )
          OR (
            effective_revision IS NOT NULL
            AND claim_token IS NOT NULL
            AND started_at IS NOT NULL
          )
        )
      )
      OR (
        status = 'superseded'
        AND effective_revision IS NULL
        AND claim_token IS NULL
        AND started_at IS NULL
        AND completed_at IS NOT NULL
        AND actual_provider_request_count = 0
        AND returned_listing_count = 0
        AND published_current_count = 0
        AND failure_code IS NULL
        AND superseded_by_run_id IS NOT NULL
        AND superseded_by_run_id <> run_id
      )
    ),
  CONSTRAINT listing_search_runs_profile_effective_identity_unique
    UNIQUE (profile_key, effective_revision, run_id)
);

CREATE UNIQUE INDEX listing_search_runs_claim_token_unique
  ON listing_search_runs (claim_token)
  WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX listing_search_runs_criteria_revision_unique
  ON listing_search_runs (profile_key, requested_revision)
  WHERE trigger_reason = 'criteria-change';

CREATE UNIQUE INDEX listing_search_runs_one_running_profile_unique
  ON listing_search_runs (profile_key)
  WHERE status = 'running';

CREATE UNIQUE INDEX listing_search_runs_active_schedule_unique
  ON listing_search_runs (profile_key, requested_revision)
  WHERE trigger_reason = 'scheduled' AND status IN ('queued', 'running');

CREATE INDEX listing_search_runs_queued_claim_idx
  ON listing_search_runs (
    profile_key,
    requested_revision DESC,
    requested_at DESC,
    run_id DESC
  )
  WHERE status = 'queued';

CREATE INDEX listing_search_runs_latest_status_idx
  ON listing_search_runs (profile_key, requested_at DESC, run_id DESC);

CREATE INDEX listing_search_runs_retention_idx
  ON listing_search_runs (completed_at, run_id)
  WHERE status IN ('succeeded', 'failed', 'superseded');

CREATE TABLE listing_search_memberships (
  profile_key text NOT NULL
    REFERENCES listing_search_profiles (profile_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES listings (id) ON DELETE RESTRICT,
  applied_revision bigint NOT NULL,
  last_successful_run_id uuid NOT NULL,
  lifecycle_state text NOT NULL,
  first_matched_at timestamptz NOT NULL,
  last_matched_at timestamptz NOT NULL,
  last_server_observed_at timestamptz NOT NULL,
  consecutive_complete_run_absence_count integer NOT NULL DEFAULT 0,
  inactive_at timestamptz,
  explicit_provider_status text,
  explicit_provider_status_observed_at timestamptz,
  lifecycle_changed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_key, listing_id),
  CONSTRAINT listing_search_memberships_run_revision_fk
    FOREIGN KEY (profile_key, applied_revision, last_successful_run_id)
    REFERENCES listing_search_runs (
      profile_key,
      effective_revision,
      run_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT listing_search_memberships_revision_check
    CHECK (applied_revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT listing_search_memberships_lifecycle_check
    CHECK (
      lifecycle_state IN (
        'current',
        'out_of_scope',
        'missing',
        'inactive',
        'sold'
      )
    ),
  CONSTRAINT listing_search_memberships_absence_count_check
    CHECK (consecutive_complete_run_absence_count BETWEEN 0 AND 2147483647),
  CONSTRAINT listing_search_memberships_state_shape_check
    CHECK ((
      (
        lifecycle_state IN ('current', 'out_of_scope')
        AND consecutive_complete_run_absence_count = 0
        AND inactive_at IS NULL
        AND explicit_provider_status IS NULL
        AND explicit_provider_status_observed_at IS NULL
      )
      OR (
        lifecycle_state = 'missing'
        AND consecutive_complete_run_absence_count >= 1
        AND inactive_at IS NULL
        AND explicit_provider_status IS NULL
        AND explicit_provider_status_observed_at IS NULL
      )
      OR (
        lifecycle_state = 'inactive'
        AND consecutive_complete_run_absence_count >= 2
        AND inactive_at IS NOT NULL
        AND inactive_at >= last_server_observed_at
        AND explicit_provider_status IS NULL
        AND explicit_provider_status_observed_at IS NULL
      )
      OR (
        lifecycle_state = 'sold'
        AND inactive_at IS NULL
        AND explicit_provider_status = 'sold'
        AND explicit_provider_status_observed_at = last_server_observed_at
      )
    ) IS TRUE),
  CONSTRAINT listing_search_memberships_timestamps_check
    CHECK (
      last_matched_at >= first_matched_at
      AND last_server_observed_at >= last_matched_at
      AND lifecycle_changed_at >= first_matched_at
      AND updated_at >= created_at
    )
);

CREATE INDEX listing_search_memberships_current_idx
  ON listing_search_memberships (
    profile_key,
    applied_revision,
    last_matched_at DESC,
    listing_id
  )
  WHERE lifecycle_state = 'current';

CREATE INDEX listing_search_memberships_history_idx
  ON listing_search_memberships (
    profile_key,
    lifecycle_state,
    lifecycle_changed_at DESC,
    listing_id
  );

CREATE INDEX listing_search_memberships_retention_idx
  ON listing_search_memberships (
    lifecycle_changed_at,
    profile_key,
    listing_id
  )
  WHERE lifecycle_state IN ('out_of_scope', 'inactive');

CREATE INDEX listing_search_memberships_listing_idx
  ON listing_search_memberships (listing_id);

CREATE INDEX listings_rentcast_retention_idx
  ON listings (updated_at, id)
  WHERE source = 'rentcast';

CREATE INDEX listing_alert_events_retention_idx
  ON listing_alert_events (observed_at, id)
  WHERE status = 'sent';
