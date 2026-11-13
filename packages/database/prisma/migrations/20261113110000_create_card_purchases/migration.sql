-- US-039 / INV-014: a purchase already made with the card, recorded once as
-- expense and card obligation in exactly one cycle. It never references the
-- paying account; only a declared settlement changes it (US-041).

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'card-purchase';

CREATE TABLE "card_purchases" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "category_id" UUID,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "external_id" VARCHAR(255),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "cycle_closes_on" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "card_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_purchases_card_id_owner_id_fkey"
    FOREIGN KEY ("card_id", "owner_id")
    REFERENCES "credit_cards"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_purchases_category_id_owner_id_fkey"
    FOREIGN KEY ("category_id", "owner_id")
    REFERENCES "categories"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_purchases_positive_amount_check"
    CHECK ("amount_minor_units" > 0),
  CONSTRAINT "card_purchases_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18)
);

CREATE UNIQUE INDEX "card_purchases_id_owner_id_key"
  ON "card_purchases"("id", "owner_id");
CREATE INDEX "card_purchases_owner_id_card_id_cycle_closes_on_occurred_at_idx"
  ON "card_purchases"("owner_id", "card_id", "cycle_closes_on", "occurred_at");
