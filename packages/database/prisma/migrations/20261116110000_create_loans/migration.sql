-- US-047 / ADR-042: loans to pay or receive declared by the holder. The
-- schedule is frozen; payments, prepayment, renegotiation and reversals are
-- append-only events from which the pending balance is derived (INV-048).

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'loan';

CREATE TABLE "loans" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "counterparty_id" UUID,
  "description" VARCHAR(500) NOT NULL,
  "principal_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "contracted_on" DATE NOT NULL,
  "first_due_on" DATE NOT NULL,
  "installment_count" SMALLINT NOT NULL,
  "rate_method" VARCHAR(16),
  "rate_percent_per_period" VARCHAR(16),
  "rate_periodicity" VARCHAR(16),
  "profile" VARCHAR(16) NOT NULL,
  "declared_amounts" TEXT[],
  "late_fee_percent" VARCHAR(16),
  "business_day_rule" VARCHAR(24) NOT NULL,
  "allocation_order" TEXT[],
  "calculation_version" INTEGER NOT NULL,
  "renegotiated_from_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "loans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loans_counterparty_id_owner_id_fkey"
    FOREIGN KEY ("counterparty_id", "owner_id")
    REFERENCES "counterparties"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loans_direction_check"
    CHECK ("direction" IN ('payable', 'receivable')),
  CONSTRAINT "loans_profile_check"
    CHECK ("profile" IN ('constant', 'decreasing', 'declared')),
  CONSTRAINT "loans_business_day_rule_check"
    CHECK ("business_day_rule" IN ('next-business-day', 'none')),
  CONSTRAINT "loans_count_check"
    CHECK ("installment_count" BETWEEN 1 AND 420),
  CONSTRAINT "loans_principal_check" CHECK ("principal_minor_units" > 0),
  CONSTRAINT "loans_dates_check" CHECK ("first_due_on" >= "contracted_on"),
  CONSTRAINT "loans_rate_check"
    CHECK (
      ("rate_method" IS NULL AND "rate_percent_per_period" IS NULL AND "rate_periodicity" IS NULL)
      OR ("rate_method" IN ('simple', 'compound')
        AND "rate_percent_per_period" IS NOT NULL
        AND "rate_periodicity" = 'monthly')
    ),
  CONSTRAINT "loans_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18)
);

CREATE UNIQUE INDEX "loans_id_owner_id_key" ON "loans"("id", "owner_id");
CREATE INDEX "loans_owner_id_created_at_idx" ON "loans"("owner_id", "created_at");
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_renegotiated_from_id_owner_id_fkey"
    FOREIGN KEY ("renegotiated_from_id", "owner_id")
    REFERENCES "loans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loan_installments" (
  "loan_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "number" SMALLINT NOT NULL,
  "scheduled_due_on" DATE NOT NULL,
  "due_on" DATE NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "principal_minor_units" DECIMAL(1000,0) NOT NULL,
  "interest_minor_units" DECIMAL(1000,0) NOT NULL,
  CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("loan_id", "number"),
  CONSTRAINT "loan_installments_loan_id_owner_id_fkey"
    FOREIGN KEY ("loan_id", "owner_id")
    REFERENCES "loans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_installments_amounts_check"
    CHECK (
      "amount_minor_units" > 0
      AND "principal_minor_units" >= 0
      AND "interest_minor_units" >= 0
      AND "amount_minor_units" = "principal_minor_units" + "interest_minor_units"
    ),
  CONSTRAINT "loan_installments_due_check" CHECK ("due_on" >= "scheduled_due_on")
);

CREATE TABLE "loan_events" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "loan_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "occurred_on" DATE,
  "amount_minor_units" DECIMAL(1000,0),
  "discount_minor_units" DECIMAL(1000,0),
  "declared_fee_minor_units" DECIMAL(1000,0),
  "allocation_order" TEXT[],
  "excess" VARCHAR(24),
  "reversed_event_id" UUID,
  "reason" VARCHAR(500),
  "new_loan_id" UUID,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "loan_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loan_events_loan_id_owner_id_fkey"
    FOREIGN KEY ("loan_id", "owner_id")
    REFERENCES "loans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_events_kind_check"
    CHECK ("kind" IN ('payment', 'prepayment', 'renegotiation', 'reversal')),
  CONSTRAINT "loan_events_excess_check"
    CHECK ("excess" IS NULL OR "excess" IN ('extra-amortization', 'receivable-credit')),
  CONSTRAINT "loan_events_shape_check"
    CHECK (
      ("kind" = 'payment' AND "occurred_on" IS NOT NULL AND "amount_minor_units" > 0)
      OR ("kind" = 'prepayment' AND "occurred_on" IS NOT NULL
        AND "amount_minor_units" >= 0 AND "discount_minor_units" >= 0)
      OR ("kind" = 'renegotiation' AND "occurred_on" IS NOT NULL AND "new_loan_id" IS NOT NULL)
      OR ("kind" = 'reversal' AND "reversed_event_id" IS NOT NULL AND "reason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "loan_events_loan_id_sequence_key" ON "loan_events"("loan_id", "sequence");
CREATE INDEX "loan_events_owner_id_loan_id_idx" ON "loan_events"("owner_id", "loan_id");

-- Frozen schedule and append-only history (ADR-042): corrections use a
-- reversal event; renegotiation creates a new linked loan.
CREATE FUNCTION "loans_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'loan schedules and events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loans_reject_update_or_delete"
  BEFORE UPDATE OR DELETE ON "loans"
  FOR EACH ROW EXECUTE FUNCTION "loans_reject_change"();
CREATE TRIGGER "loan_installments_reject_update_or_delete"
  BEFORE UPDATE OR DELETE ON "loan_installments"
  FOR EACH ROW EXECUTE FUNCTION "loans_reject_change"();
CREATE TRIGGER "loan_events_reject_update_or_delete"
  BEFORE UPDATE OR DELETE ON "loan_events"
  FOR EACH ROW EXECUTE FUNCTION "loans_reject_change"();
