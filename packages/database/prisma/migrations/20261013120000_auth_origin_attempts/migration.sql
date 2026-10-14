CREATE TABLE auth_origin_attempts (
  origin_hash BYTEA NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'recovery')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin_hash, purpose)
);

CREATE INDEX auth_origin_attempts_updated_at_idx ON auth_origin_attempts (updated_at);

CREATE TABLE auth_origin_login_reservations (
  id UUID PRIMARY KEY,
  origin_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_origin_login_reservations_origin_idx
  ON auth_origin_login_reservations (origin_hash, expires_at);
