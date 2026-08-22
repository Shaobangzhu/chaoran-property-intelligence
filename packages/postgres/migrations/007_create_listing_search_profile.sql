CREATE TABLE listing_search_profiles (
  profile_key text PRIMARY KEY,
  schema_version integer NOT NULL,
  criteria jsonb NOT NULL,
  revision bigint NOT NULL,
  applied_revision bigint NOT NULL,
  updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_search_profiles_primary_key_check
    CHECK (profile_key = 'primary'),
  CONSTRAINT listing_search_profiles_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT listing_search_profiles_criteria_object_check
    CHECK (jsonb_typeof(criteria) = 'object'),
  CONSTRAINT listing_search_profiles_criteria_version_check
    CHECK ((criteria -> 'schemaVersion' = to_jsonb(schema_version)) IS TRUE),
  CONSTRAINT listing_search_profiles_fixed_scope_check
    CHECK (criteria @> '{"state": "CA", "status": "Active"}'::jsonb),
  CONSTRAINT listing_search_profiles_revision_check
    CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT listing_search_profiles_applied_revision_check
    CHECK (applied_revision BETWEEN 1 AND revision),
  CONSTRAINT listing_search_profiles_timestamps_check
    CHECK (updated_at >= created_at)
);

INSERT INTO listing_search_profiles (
  profile_key,
  schema_version,
  criteria,
  revision,
  applied_revision,
  updated_by_user_id
)
VALUES (
  'primary',
  1,
  '{
    "schemaVersion": 1,
    "state": "CA",
    "status": "Active",
    "propertyType": "Single Family",
    "minimumPrice": 780000,
    "maximumPrice": 850000,
    "minimumBedrooms": 4,
    "minimumBathrooms": 2.5,
    "cities": [
      "Chino",
      "Chino Hills",
      "Eastvale",
      "Corona",
      "Jurupa Valley"
    ]
  }'::jsonb,
  1,
  1,
  NULL
);
