-- US-044 / ADR-042: installment plan of a purchase already recorded with the
-- card. The purchase stays the expense; its obligation moves to one
-- installment per consecutive cycle. Parameters and schedule are frozen.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'card-installment-plan';

CREATE TABLE "card_installment_plans" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL,
  "calculation_version" INTEGER NOT NULL,
  "installment_count" SMALLINT NOT NULL,
  "rate_method" VARCHAR(16),
  "rate_percent_per_period" VARCHAR(16),
  "rate_periodicity" VARCHAR(16),
  "principal_minor_units" DECIMAL(1000,0) NOT NULL,
  "interest_minor_units" DECIMAL(1000,0) NOT NULL,
  "total_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "card_installment_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_installment_plans_card_id_owner_id_fkey"
    FOREIGN KEY ("card_id", "owner_id")
    REFERENCES "credit_cards"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_installment_plans_purchase_id_owner_id_fkey"
    FOREIGN KEY ("purchase_id", "owner_id")
    REFERENCES "card_purchases"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_installment_plans_count_check"
    CHECK ("installment_count" BETWEEN 1 AND 420),
  CONSTRAINT "card_installment_plans_amounts_check"
    CHECK (
      "principal_minor_units" > 0
      AND "interest_minor_units" >= 0
      AND "total_minor_units" = "principal_minor_units" + "interest_minor_units"
    ),
  CONSTRAINT "card_installment_plans_rate_check"
    CHECK (
      ("rate_method" IS NULL AND "rate_percent_per_period" IS NULL AND "rate_periodicity" IS NULL)
      OR ("rate_method" IN ('simple', 'compound')
        AND "rate_percent_per_period" IS NOT NULL
        AND "rate_periodicity" = 'monthly')
    ),
  CONSTRAINT "card_installment_plans_status_check"
    CHECK ("status" IN ('active')),
  CONSTRAINT "card_installment_plans_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18)
);

CREATE UNIQUE INDEX "card_installment_plans_purchase_id_key"
  ON "card_installment_plans"("purchase_id");
CREATE UNIQUE INDEX "card_installment_plans_id_owner_id_key"
  ON "card_installment_plans"("id", "owner_id");
CREATE UNIQUE INDEX "card_installment_plans_purchase_id_owner_id_key"
  ON "card_installment_plans"("purchase_id", "owner_id");
CREATE INDEX "card_installment_plans_owner_id_card_id_idx"
  ON "card_installment_plans"("owner_id", "card_id");

CREATE TABLE "card_installments" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "number" SMALLINT NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "principal_minor_units" DECIMAL(1000,0) NOT NULL,
  "interest_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "cycle_closes_on" DATE NOT NULL,
  CONSTRAINT "card_installments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_installments_plan_id_owner_id_fkey"
    FOREIGN KEY ("plan_id", "owner_id")
    REFERENCES "card_installment_plans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_installments_number_check"
    CHECK ("number" BETWEEN 1 AND 420),
  CONSTRAINT "card_installments_amounts_check"
    CHECK (
      "amount_minor_units" > 0
      AND "principal_minor_units" >= 0
      AND "interest_minor_units" >= 0
      AND "amount_minor_units" = "principal_minor_units" + "interest_minor_units"
    ),
  CONSTRAINT "card_installments_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18)
);

CREATE UNIQUE INDEX "card_installments_plan_id_number_key"
  ON "card_installments"("plan_id", "number");
CREATE INDEX "card_installments_owner_id_card_id_cycle_closes_on_idx"
  ON "card_installments"("owner_id", "card_id", "cycle_closes_on");

-- Frozen schedule (ADR-042): renegotiation creates a new linked plan.
CREATE FUNCTION "card_installments_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'card installments are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "card_installments_reject_update_or_delete"
  BEFORE UPDATE OR DELETE ON "card_installments"
  FOR EACH ROW EXECUTE FUNCTION "card_installments_reject_change"();
