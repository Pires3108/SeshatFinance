-- US-041 / INV-015, INV-018: a payment declared outside the app reduces the
-- paying account (through one linked movement) and the invoice obligation by
-- the same amount, without a second expense. The linked movement is frozen.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'invoice-settlement';

CREATE TABLE "invoice_settlements" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "invoice_closes_on" DATE NOT NULL,
  "account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "paid_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "invoice_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_settlements_card_id_owner_id_fkey"
    FOREIGN KEY ("card_id", "owner_id")
    REFERENCES "credit_cards"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_settlements_invoice_fkey"
    FOREIGN KEY ("owner_id", "card_id", "invoice_closes_on")
    REFERENCES "card_invoices"("owner_id", "card_id", "closes_on")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "invoice_settlements_transaction_id_owner_id_fkey"
    FOREIGN KEY ("transaction_id", "owner_id")
    REFERENCES "transactions"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_settlements_positive_amount_check"
    CHECK ("amount_minor_units" > 0)
);

CREATE UNIQUE INDEX "invoice_settlements_transaction_id_key"
  ON "invoice_settlements"("transaction_id");
CREATE UNIQUE INDEX "invoice_settlements_transaction_id_owner_id_key"
  ON "invoice_settlements"("transaction_id", "owner_id");
CREATE UNIQUE INDEX "invoice_settlements_id_owner_id_key"
  ON "invoice_settlements"("id", "owner_id");
CREATE INDEX "invoice_settlements_owner_id_card_id_invoice_closes_on_idx"
  ON "invoice_settlements"("owner_id", "card_id", "invoice_closes_on");

-- The account effect of a settlement cannot change on its own. Time zone
-- reinterpretation (ADR-034) and tags remain allowed.
CREATE FUNCTION "transactions_settlement_entry_is_frozen"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "invoice_settlements" WHERE "transaction_id" = OLD."id"
  ) AND (
    NEW."amount_minor_units" IS DISTINCT FROM OLD."amount_minor_units"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
    OR NEW."lifecycle" IS DISTINCT FROM OLD."lifecycle"
    OR NEW."eliminated_at" IS DISTINCT FROM OLD."eliminated_at"
    OR NEW."currency_code" IS DISTINCT FROM OLD."currency_code"
  ) THEN
    RAISE EXCEPTION 'card settlement entry % is frozen', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_settlement_entry_is_frozen"
  BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "transactions_settlement_entry_is_frozen"();
