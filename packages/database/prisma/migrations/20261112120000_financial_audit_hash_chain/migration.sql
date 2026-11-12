-- US-035 / ADR-036: per-owner SHA-256 hash chain over the append-only
-- financial audit trail, plus the result, error code and correlation fields
-- of the 27/09 metadata allowlist.

ALTER TABLE "financial_audit_events"
  ADD COLUMN "owner_sequence" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "previous_hash" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "hash" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "result" VARCHAR(16) NOT NULL DEFAULT 'succeeded',
  ADD COLUMN "error_code" VARCHAR(64),
  ADD COLUMN "correlation_id" UUID;

ALTER TABLE "financial_audit_events"
  ADD CONSTRAINT "financial_audit_events_result_check"
  CHECK ("result" IN ('succeeded', 'failed'));

-- Canonical text: fields joined by '|', instant in UTC with microseconds,
-- absent optional values as empty text.
CREATE FUNCTION "financial_audit_event_hash"(
  "sequence" BIGINT,
  "previous" CHAR(64),
  "event_id" UUID,
  "owner" UUID,
  "actor" UUID,
  "event_action" TEXT,
  "event_resource_type" TEXT,
  "event_resource_id" UUID,
  "at" TIMESTAMPTZ,
  "event_result" TEXT,
  "event_error_code" TEXT,
  "event_correlation_id" UUID
)
RETURNS CHAR(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          "sequence"::text,
          "previous",
          "event_id"::text,
          "owner"::text,
          "actor"::text,
          "event_action",
          "event_resource_type",
          "event_resource_id"::text,
          to_char("at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          "event_result",
          coalesce("event_error_code", ''),
          coalesce("event_correlation_id"::text, '')
        ),
        'UTF8'
      )
    ),
    'hex'
  )
$$;

-- Last link of each owner's chain. Locking this row serializes appends per
-- owner: READ COMMITTED waits and reads the latest head, SERIALIZABLE fails
-- with a retryable serialization error instead of forking the chain.
CREATE TABLE "financial_audit_chain_heads" (
  "owner_id" UUID NOT NULL,
  "last_sequence" BIGINT NOT NULL,
  "last_hash" CHAR(64) NOT NULL,

  CONSTRAINT "financial_audit_chain_heads_pkey" PRIMARY KEY ("owner_id")
);

-- Backfill the existing trail in (occurred_at, id) order per owner. The
-- append-only trigger is disabled only inside this migration transaction.
ALTER TABLE "financial_audit_events"
  DISABLE TRIGGER "financial_audit_events_reject_update_or_delete";

DO $$
DECLARE
  event RECORD;
  current_owner UUID := NULL;
  next_sequence BIGINT := 0;
  last_hash CHAR(64) := repeat('0', 64);
  event_hash CHAR(64);
BEGIN
  FOR event IN
    SELECT * FROM "financial_audit_events"
    ORDER BY "owner_id", "occurred_at", "id"
  LOOP
    IF current_owner IS DISTINCT FROM event."owner_id" THEN
      IF current_owner IS NOT NULL THEN
        INSERT INTO "financial_audit_chain_heads"
          VALUES (current_owner, next_sequence, last_hash);
      END IF;
      current_owner := event."owner_id";
      next_sequence := 0;
      last_hash := repeat('0', 64);
    END IF;
    next_sequence := next_sequence + 1;
    event_hash := "financial_audit_event_hash"(
      next_sequence, last_hash, event."id", event."owner_id", event."actor_id",
      event."action"::text, event."resource_type"::text, event."resource_id",
      event."occurred_at", event."result", event."error_code",
      event."correlation_id"
    );
    UPDATE "financial_audit_events"
      SET "owner_sequence" = next_sequence,
          "previous_hash" = last_hash,
          "hash" = event_hash
      WHERE "id" = event."id";
    last_hash := event_hash;
  END LOOP;
  IF current_owner IS NOT NULL THEN
    INSERT INTO "financial_audit_chain_heads"
      VALUES (current_owner, next_sequence, last_hash);
  END IF;
END;
$$;

ALTER TABLE "financial_audit_events"
  ENABLE TRIGGER "financial_audit_events_reject_update_or_delete";

CREATE UNIQUE INDEX "financial_audit_events_owner_id_owner_sequence_key"
  ON "financial_audit_events"("owner_id", "owner_sequence");

CREATE FUNCTION "link_financial_audit_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  head_sequence BIGINT;
  head_hash CHAR(64);
BEGIN
  INSERT INTO "financial_audit_chain_heads"
    VALUES (NEW."owner_id", 0, repeat('0', 64))
    ON CONFLICT ("owner_id") DO NOTHING;
  SELECT "last_sequence", "last_hash" INTO head_sequence, head_hash
    FROM "financial_audit_chain_heads"
    WHERE "owner_id" = NEW."owner_id"
    FOR UPDATE;
  NEW."owner_sequence" := head_sequence + 1;
  NEW."previous_hash" := head_hash;
  NEW."hash" := "financial_audit_event_hash"(
    NEW."owner_sequence", NEW."previous_hash", NEW."id", NEW."owner_id",
    NEW."actor_id", NEW."action"::text, NEW."resource_type"::text,
    NEW."resource_id", NEW."occurred_at", NEW."result", NEW."error_code",
    NEW."correlation_id"
  );
  UPDATE "financial_audit_chain_heads"
    SET "last_sequence" = NEW."owner_sequence", "last_hash" = NEW."hash"
    WHERE "owner_id" = NEW."owner_id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "financial_audit_events_link_chain"
BEFORE INSERT ON "financial_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "link_financial_audit_event"();

-- Recomputes an owner's chain. Returns the number of events checked and the
-- first sequence whose position, link or hash does not match (NULL if valid).
CREATE FUNCTION "verify_financial_audit_chain"("owner" UUID)
RETURNS TABLE ("checked_events" BIGINT, "first_invalid_sequence" BIGINT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  event RECORD;
  expected_sequence BIGINT := 1;
  expected_previous CHAR(64) := repeat('0', 64);
  checked BIGINT := 0;
BEGIN
  FOR event IN
    SELECT * FROM "financial_audit_events"
    WHERE "owner_id" = "owner"
    ORDER BY "owner_sequence"
  LOOP
    checked := checked + 1;
    IF event."owner_sequence" <> expected_sequence
      OR event."previous_hash" <> expected_previous
      OR event."hash" <> "financial_audit_event_hash"(
        event."owner_sequence", event."previous_hash", event."id",
        event."owner_id", event."actor_id", event."action"::text,
        event."resource_type"::text, event."resource_id", event."occurred_at",
        event."result", event."error_code", event."correlation_id"
      )
    THEN
      RETURN QUERY SELECT checked, event."owner_sequence";
      RETURN;
    END IF;
    expected_sequence := expected_sequence + 1;
    expected_previous := event."hash";
  END LOOP;
  RETURN QUERY SELECT checked, NULL::BIGINT;
END;
$$;
