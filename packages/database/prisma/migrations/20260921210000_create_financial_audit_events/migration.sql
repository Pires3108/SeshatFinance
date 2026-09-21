CREATE TYPE "financial_audit_action" AS ENUM (
  'created',
  'updated',
  'archived',
  'unarchived',
  'moved-to-trash',
  'restored-from-trash'
);

CREATE TYPE "financial_audit_resource_type" AS ENUM (
  'account',
  'transaction',
  'transfer',
  'balance-adjustment'
);

CREATE TABLE "financial_audit_events" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" "financial_audit_action" NOT NULL,
  "resource_type" "financial_audit_resource_type" NOT NULL,
  "resource_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "financial_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "financial_audit_events_owner_id_occurred_at_id_idx"
  ON "financial_audit_events"("owner_id", "occurred_at", "id");

CREATE INDEX "financial_audit_events_owner_id_resource_type_resource_id_occurred_at_idx"
  ON "financial_audit_events"(
    "owner_id",
    "resource_type",
    "resource_id",
    "occurred_at"
  );

CREATE FUNCTION "reject_financial_audit_event_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "financial_audit_events_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "financial_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "reject_financial_audit_event_mutation"();

CREATE TRIGGER "financial_audit_events_reject_truncate"
BEFORE TRUNCATE ON "financial_audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_financial_audit_event_mutation"();
