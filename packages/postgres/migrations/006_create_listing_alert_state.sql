CREATE TABLE listing_price_observations (
  address_key text PRIMARY KEY,
  listing_key text NOT NULL
    REFERENCES listings (deduplication_key) ON DELETE RESTRICT,
  source_listing_id text NOT NULL,
  latest_price integer NOT NULL CHECK (latest_price > 0),
  latest_listed_date text NOT NULL CHECK (char_length(latest_listed_date) > 0),
  latest_last_seen_date text NOT NULL
    CHECK (char_length(latest_last_seen_date) > 0),
  comparison_ready boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_price_observations_address_key_check
    CHECK (address_key LIKE 'address:v1:%'),
  CONSTRAINT listing_price_observations_listing_key_check
    CHECK (char_length(listing_key) BETWEEN 1 AND 512),
  CONSTRAINT listing_price_observations_source_listing_id_check
    CHECK (char_length(source_listing_id) BETWEEN 1 AND 256)
);

CREATE TABLE listing_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  listing_key text NOT NULL
    REFERENCES listings (deduplication_key) ON DELETE RESTRICT,
  address_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('new-listing', 'price-drop')),
  formatted_address text NOT NULL,
  previous_price integer,
  current_price integer NOT NULL CHECK (current_price > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent')),
  observed_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_alert_events_event_key_check
    CHECK (char_length(event_key) BETWEEN 1 AND 1024),
  CONSTRAINT listing_alert_events_listing_key_check
    CHECK (char_length(listing_key) BETWEEN 1 AND 512),
  CONSTRAINT listing_alert_events_address_key_check
    CHECK (address_key LIKE 'address:v1:%'),
  CONSTRAINT listing_alert_events_formatted_address_check
    CHECK (char_length(formatted_address) BETWEEN 1 AND 512),
  CONSTRAINT listing_alert_events_price_shape_check
    CHECK (
      (
        kind = 'new-listing'
        AND previous_price IS NULL
      )
      OR (
        kind = 'price-drop'
        AND previous_price IS NOT NULL
        AND previous_price > current_price
      )
    ),
  CONSTRAINT listing_alert_events_delivery_state_check
    CHECK (
      (status = 'pending' AND sent_at IS NULL)
      OR (status = 'sent' AND sent_at IS NOT NULL)
    )
);

CREATE INDEX listing_alert_events_pending_idx
  ON listing_alert_events (observed_at, event_key)
  WHERE status = 'pending';

CREATE INDEX listing_alert_events_address_idx
  ON listing_alert_events (address_key, observed_at DESC);
