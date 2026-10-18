ALTER TYPE "financial_audit_resource_type" ADD VALUE 'manual-exchange-quote';

CREATE TABLE "manual_exchange_quote_versions" (
  "quote_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "command_type" VARCHAR(8) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "owner_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "source_currency_code" CHAR(3) NOT NULL,
  "target_currency_code" CHAR(3) NOT NULL,
  "rate" VARCHAR(1000) NOT NULL,
  "source" VARCHAR(120) NOT NULL,
  "effective_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "manual_exchange_quote_versions_pkey" PRIMARY KEY ("quote_id", "version"),
  CONSTRAINT "manual_exchange_quote_versions_pair_check" CHECK (
    "source_currency_code" IN ('BRL', 'USD', 'EUR') AND
    "target_currency_code" IN ('BRL', 'USD', 'EUR') AND
    "source_currency_code" <> "target_currency_code"
  ),
  CONSTRAINT "manual_exchange_quote_versions_rate_check" CHECK (
    "rate" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' AND
    "rate" ~ '[1-9]'
  ),
  CONSTRAINT "manual_exchange_quote_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "manual_exchange_quote_versions_command_type_check" CHECK (
    ("version" = 1 AND "command_type" = 'created') OR
    ("version" > 1 AND "command_type" = 'updated')
  ),
  CONSTRAINT "manual_exchange_quote_versions_source_check" CHECK (length(trim("source")) > 0)
);

CREATE INDEX "manual_exchange_quote_versions_owner_id_quote_id_version_idx"
  ON "manual_exchange_quote_versions"("owner_id", "quote_id", "version");

CREATE UNIQUE INDEX "manual_exchange_quote_versions_owner_id_command_type_idempotency_key_key"
  ON "manual_exchange_quote_versions"("owner_id", "command_type", "idempotency_key");

CREATE INDEX "manual_exchange_quote_versions_owner_id_recorded_at_quote_id_idx"
  ON "manual_exchange_quote_versions"("owner_id", "recorded_at", "quote_id");

CREATE FUNCTION "reject_manual_exchange_quote_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'manual exchange quote versions are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "manual_exchange_quote_versions_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "manual_exchange_quote_versions"
FOR EACH ROW
EXECUTE FUNCTION "reject_manual_exchange_quote_mutation"();

CREATE TRIGGER "manual_exchange_quote_versions_reject_truncate"
BEFORE TRUNCATE ON "manual_exchange_quote_versions"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_manual_exchange_quote_mutation"();
