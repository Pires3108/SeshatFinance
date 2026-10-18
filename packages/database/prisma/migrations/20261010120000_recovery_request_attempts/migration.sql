CREATE TABLE auth_recovery_request_attempts (
  email_hash BYTEA PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_recovery_request_attempts_updated_at_idx
  ON auth_recovery_request_attempts (updated_at);
