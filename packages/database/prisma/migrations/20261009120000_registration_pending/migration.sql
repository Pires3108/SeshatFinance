ALTER TABLE user_profiles
  ADD COLUMN registration_confirmed boolean NOT NULL DEFAULT true;

CREATE TABLE registration_intents (
  email_hash bytea PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX registration_intents_expires_at_idx ON registration_intents (expires_at);
