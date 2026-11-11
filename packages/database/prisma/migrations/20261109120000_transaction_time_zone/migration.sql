ALTER TABLE "transactions"
  ADD COLUMN "time_zone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo';

UPDATE "transactions" AS t
SET "time_zone" = p."time_zone"
FROM "user_profiles" AS p
WHERE p."id" = t."owner_id";

-- Every insert path (entries, transfers, adjustments) records the zone in
-- effect. FOR SHARE serializes against a concurrent time zone change.
CREATE FUNCTION "assign_transaction_time_zone"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  profile_time_zone VARCHAR(64);
BEGIN
  SELECT "time_zone" INTO profile_time_zone
    FROM "user_profiles" WHERE "id" = NEW."owner_id" FOR SHARE;
  NEW."time_zone" := COALESCE(profile_time_zone, 'America/Sao_Paulo');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_assign_time_zone"
BEFORE INSERT ON "transactions"
FOR EACH ROW
EXECUTE FUNCTION "assign_transaction_time_zone"();

CREATE TABLE "user_time_zone_changes" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "previous_time_zone" VARCHAR(64) NOT NULL,
  "new_time_zone" VARCHAR(64) NOT NULL,
  "scope" VARCHAR(32) NOT NULL,
  "affected_transactions" INTEGER NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "user_time_zone_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_time_zone_changes_scope_check"
    CHECK ("scope" IN ('reinterpret_existing', 'new_items_only')),
  CONSTRAINT "user_time_zone_changes_affected_check"
    CHECK ("affected_transactions" >= 0)
);

CREATE INDEX "user_time_zone_changes_owner_id_changed_at_idx"
  ON "user_time_zone_changes" ("owner_id", "changed_at");

CREATE FUNCTION "reject_user_time_zone_change_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'user time zone changes are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "user_time_zone_changes_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "user_time_zone_changes"
FOR EACH ROW
EXECUTE FUNCTION "reject_user_time_zone_change_mutation"();

CREATE TRIGGER "user_time_zone_changes_reject_truncate"
BEFORE TRUNCATE ON "user_time_zone_changes"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_user_time_zone_change_mutation"();
