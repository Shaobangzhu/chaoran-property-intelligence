ALTER TABLE listings
  ADD COLUMN created_by_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN notes text,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE listings
  ALTER COLUMN source_listing_id DROP NOT NULL,
  ALTER COLUMN property_type DROP NOT NULL,
  ALTER COLUMN bedrooms DROP NOT NULL,
  ALTER COLUMN bathrooms DROP NOT NULL,
  ALTER COLUMN price DROP NOT NULL,
  ALTER COLUMN listed_date DROP NOT NULL;

ALTER TABLE listings
  DROP CONSTRAINT listings_source_check,
  DROP CONSTRAINT listings_notification_status_check;

ALTER TABLE listings
  ADD CONSTRAINT listings_source_check
    CHECK (source IN ('rentcast', 'manual')),
  ADD CONSTRAINT listings_notification_status_check
    CHECK (
      notification_status IN ('baseline', 'pending', 'sent', 'not_applicable')
    ),
  ADD CONSTRAINT listings_source_identity_check
    CHECK (
      (
        source = 'rentcast'
        AND source_listing_id IS NOT NULL
        AND created_by_user_id IS NULL
      )
      OR (
        source = 'manual'
        AND source_listing_id IS NULL
        AND created_by_user_id IS NOT NULL
      )
    ),
  ADD CONSTRAINT listings_source_facts_check
    CHECK (
      source = 'manual'
      OR (
        property_type IS NOT NULL
        AND bedrooms IS NOT NULL
        AND bathrooms IS NOT NULL
        AND price IS NOT NULL
        AND listed_date IS NOT NULL
      )
    ),
  ADD CONSTRAINT listings_source_notification_check
    CHECK (
      (source = 'manual' AND notification_status = 'not_applicable')
      OR (
        source = 'rentcast'
        AND notification_status IN ('baseline', 'pending', 'sent')
      )
    ),
  ADD CONSTRAINT listings_coordinates_check
    CHECK (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    ),
  ADD CONSTRAINT listings_optional_numbers_nonnegative
    CHECK (
      (bedrooms IS NULL OR bedrooms >= 0)
      AND (bathrooms IS NULL OR bathrooms >= 0)
      AND (price IS NULL OR price >= 0)
    ),
  ADD CONSTRAINT listings_notes_bounded
    CHECK (notes IS NULL OR char_length(notes) <= 4000),
  ADD CONSTRAINT listings_manual_metadata_check
    CHECK (
      source = 'manual'
      OR (notes IS NULL AND archived_at IS NULL)
    );

CREATE INDEX listings_active_idx
  ON listings (listed_date DESC, id)
  WHERE archived_at IS NULL;
