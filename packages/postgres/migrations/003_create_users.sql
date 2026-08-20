CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  password_hash text NOT NULL CHECK (password_hash <> ''),
  role text NOT NULL CHECK (role IN ('admin')),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_normalized_email_unique UNIQUE (normalized_email),
  CONSTRAINT users_normalized_email_bounded
    CHECK (char_length(normalized_email) BETWEEN 1 AND 254),
  CONSTRAINT users_normalized_email_canonical
    CHECK (normalized_email = lower(btrim(normalized_email)))
);
