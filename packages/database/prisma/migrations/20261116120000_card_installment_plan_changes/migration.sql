-- US-046 / ADR-042: prepayment and renegotiation of card installment plans.
-- Installments stay immutable; append-only changes say which future
-- installments left their cycles. A renegotiated plan is a new plan linked
-- to the previous one, so only root plans are unique per purchase.

DROP INDEX "card_installment_plans_purchase_id_key";
DROP INDEX "card_installment_plans_purchase_id_owner_id_key";

ALTER TABLE "card_installment_plans"
  ADD COLUMN "renegotiated_from_id" UUID,
  ADD CONSTRAINT "card_installment_plans_renegotiated_from_id_owner_id_fkey"
    FOREIGN KEY ("renegotiated_from_id", "owner_id")
    REFERENCES "card_installment_plans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "card_installment_plans_root_purchase_key"
  ON "card_installment_plans"("purchase_id")
  WHERE "renegotiated_from_id" IS NULL;
CREATE UNIQUE INDEX "card_installment_plans_renegotiated_from_key"
  ON "card_installment_plans"("renegotiated_from_id")
  WHERE "renegotiated_from_id" IS NOT NULL;
CREATE INDEX "card_installment_plans_owner_id_purchase_id_idx"
  ON "card_installment_plans"("owner_id", "purchase_id");

CREATE TABLE "card_installment_plan_changes" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "effective_cycle_closes_on" DATE,
  "amount_minor_units" DECIMAL(1000,0),
  "discount_minor_units" DECIMAL(1000,0),
  "new_plan_id" UUID,
  "reversed_change_id" UUID,
  "reason" VARCHAR(500),
  "recorded_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "card_installment_plan_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_installment_plan_changes_plan_id_owner_id_fkey"
    FOREIGN KEY ("plan_id", "owner_id")
    REFERENCES "card_installment_plans"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_installment_plan_changes_shape_check"
    CHECK (
      ("kind" = 'prepayment' AND "effective_cycle_closes_on" IS NOT NULL
        AND "amount_minor_units" >= 0 AND "discount_minor_units" >= 0)
      OR ("kind" = 'renegotiation' AND "effective_cycle_closes_on" IS NOT NULL
        AND "new_plan_id" IS NOT NULL)
      OR ("kind" = 'reversal' AND "reversed_change_id" IS NOT NULL
        AND "reason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "card_installment_plan_changes_plan_id_sequence_key"
  ON "card_installment_plan_changes"("plan_id", "sequence");
CREATE INDEX "card_installment_plan_changes_owner_id_plan_id_idx"
  ON "card_installment_plan_changes"("owner_id", "plan_id");

CREATE TRIGGER "card_installment_plan_changes_reject_update_or_delete"
  BEFORE UPDATE OR DELETE ON "card_installment_plan_changes"
  FOR EACH ROW EXECUTE FUNCTION "card_installments_reject_change"();
