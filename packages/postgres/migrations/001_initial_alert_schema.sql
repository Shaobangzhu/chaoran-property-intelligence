CREATE TABLE IF NOT EXISTS alert_worker_state (
  state_key text PRIMARY KEY,
  initialized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  deduplication_key text PRIMARY KEY,
  source text NOT NULL CHECK (source = 'rentcast'),
  source_listing_id text NOT NULL,
  mls_name text,
  mls_number text,
  formatted_address text NOT NULL,
  address_line_1 text NOT NULL,
  address_line_2 text,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  property_type text NOT NULL,
  bedrooms double precision NOT NULL,
  bathrooms double precision NOT NULL,
  price integer NOT NULL,
  status text NOT NULL,
  listed_date text NOT NULL,
  last_seen_date text NOT NULL,
  first_discovered_at text NOT NULL,
  notification_status text NOT NULL
    CHECK (notification_status IN ('baseline', 'pending', 'sent'))
);

CREATE INDEX IF NOT EXISTS listings_notification_status_idx
  ON listings (notification_status);
