CREATE TABLE auth_login_attempts (
  email_hash BYTEA PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_login_attempts_updated_at_idx ON auth_login_attempts (updated_at);
