-- US-052 / ADR-043: monthly budgets per dimension (category, cost center or
-- account). Consumption is a read projection over transactions; nothing here
-- blocks, cancels or changes a transaction (RF-072, CA-018). Limit versions
-- apply from a civil month on, so past months keep their limit.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'budget';

CREATE TABLE "budgets" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "dimension_kind" VARCHAR(16) NOT NULL,
  "dimension_id" UUID NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "lifecycle" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budgets_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "budgets_dimension_kind_check"
    CHECK ("dimension_kind" IN ('category', 'cost-center', 'account')),
  CONSTRAINT "budgets_lifecycle_check"
    CHECK ("lifecycle" IN ('active', 'archived')),
  CONSTRAINT "budgets_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "budgets_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "budgets_id_owner_id_key" ON "budgets"("id", "owner_id");
CREATE INDEX "budgets_owner_id_created_at_idx" ON "budgets"("owner_id", "created_at");
-- ADR-043: no two active budgets for the same dimension and currency.
CREATE UNIQUE INDEX "budgets_active_dimension_key"
  ON "budgets"("owner_id", "dimension_kind", "dimension_id", "currency_code", "currency_minor_unit_scale")
  WHERE "lifecycle" = 'active';

CREATE TABLE "budget_limit_versions" (
  "budget_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "effective_from" CHAR(7) NOT NULL,
  "limit_minor_units" DECIMAL(1000,0) NOT NULL,
  CONSTRAINT "budget_limit_versions_pkey" PRIMARY KEY ("budget_id", "effective_from"),
  CONSTRAINT "budget_limit_versions_budget_fkey"
    FOREIGN KEY ("budget_id", "owner_id")
    REFERENCES "budgets"("id", "owner_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "budget_limit_versions_month_check"
    CHECK ("effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "budget_limit_versions_limit_check" CHECK ("limit_minor_units" > 0)
);
