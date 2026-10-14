ALTER TYPE "financial_audit_resource_type" ADD VALUE 'card-purchase';

CREATE TABLE "card_purchases" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "external_id" VARCHAR(255),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  CONSTRAINT "card_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_purchases_card_id_owner_id_fkey" FOREIGN KEY ("card_id", "owner_id") REFERENCES "credit_cards"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_purchases_positive_amount_check" CHECK ("amount_minor_units" > 0),
  CONSTRAINT "card_purchases_currency_scale_check" CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18)
);
CREATE UNIQUE INDEX "card_purchases_owner_id_idempotency_key_key" ON "card_purchases"("owner_id", "idempotency_key");
CREATE INDEX "card_purchases_owner_id_card_id_occurred_at_idx" ON "card_purchases"("owner_id", "card_id", "occurred_at");
