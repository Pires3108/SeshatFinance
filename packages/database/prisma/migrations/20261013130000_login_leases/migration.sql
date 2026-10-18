CREATE TABLE auth_login_leases (
  email_hash BYTEA PRIMARY KEY,
  holder UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_login_leases_expires_at_idx ON auth_login_leases (expires_at);
