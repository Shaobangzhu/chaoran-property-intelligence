ALTER TABLE listings
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE listings
  DROP CONSTRAINT listings_pkey;

ALTER TABLE listings
  ADD CONSTRAINT listings_pkey PRIMARY KEY (id);

ALTER TABLE listings
  ADD CONSTRAINT listings_deduplication_key_unique
  UNIQUE (deduplication_key);
