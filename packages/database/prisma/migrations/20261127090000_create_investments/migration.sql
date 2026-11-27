-- US-054 / ADR-044: manually declared investments. Registering one records
-- descriptive data only; it never creates a transaction nor changes balances
-- or net worth. The contracted rate is descriptive and never used to compute
-- cost, value or return.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'investment';

CREATE TABLE "investments" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "institution" VARCHAR(120) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(20),
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "start_date" DATE NOT NULL,
  "maturity_date" DATE,
  "rate_indexer" VARCHAR(16),
  "rate_percent" VARCHAR(24),
  "liquidity_kind" VARCHAR(16) NOT NULL,
  "liquidity_days" INTEGER,
  "lifecycle" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "investments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investments_type_check" CHECK ("type" IN (
    'treasury-direct', 'cdb', 'lci', 'lca', 'savings', 'stock', 'fii', 'etf',
    'cryptocurrency', 'investment-fund', 'private-pension'
  )),
  CONSTRAINT "investments_institution_check" CHECK (length(btrim("institution")) > 0),
  CONSTRAINT "investments_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "investments_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "investments_maturity_check"
    CHECK ("maturity_date" IS NULL OR "maturity_date" >= "start_date"),
  CONSTRAINT "investments_rate_check" CHECK (
    ("rate_indexer" IS NULL AND "rate_percent" IS NULL)
    OR ("rate_indexer" IN ('cdi', 'selic', 'ipca', 'prefixed', 'other')
        AND "rate_percent" ~ '^[0-9]+(\.[0-9]+)?$')
  ),
  CONSTRAINT "investments_liquidity_check" CHECK (
    ("liquidity_kind" IN ('daily', 'at-maturity') AND "liquidity_days" IS NULL)
    OR ("liquidity_kind" = 'd-plus' AND "liquidity_days" BETWEEN 0 AND 3650)
  ),
  CONSTRAINT "investments_lifecycle_check"
    CHECK ("lifecycle" IN ('active', 'archived', 'trashed')),
  CONSTRAINT "investments_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "investments_id_owner_id_key" ON "investments"("id", "owner_id");
CREATE INDEX "investments_owner_id_created_at_idx" ON "investments"("owner_id", "created_at");
