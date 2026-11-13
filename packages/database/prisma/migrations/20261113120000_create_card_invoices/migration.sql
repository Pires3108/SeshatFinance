-- US-040 / INV-017: one invoice per card cycle with its dates, rule and
-- holiday dataset frozen at formation. Manual closing freezes the purchases
-- total; it creates no expense and never touches the paying account.

ALTER TYPE "financial_audit_action" ADD VALUE 'closed';
ALTER TYPE "financial_audit_resource_type" ADD VALUE 'card-invoice';

ALTER TABLE "card_purchases"
  ADD COLUMN "posted_after_close" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "card_invoices" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "closes_on" DATE NOT NULL,
  "first_purchase_date" DATE NOT NULL,
  "last_purchase_date" DATE NOT NULL,
  "scheduled_due_on" DATE NOT NULL,
  "due_on" DATE NOT NULL,
  "closing_boundary" VARCHAR(16) NOT NULL,
  "configuration_pending" BOOLEAN NOT NULL,
  "holiday_dataset_version" VARCHAR(40) NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "status" VARCHAR(8) NOT NULL,
  "closed_at" TIMESTAMPTZ(6),
  "closed_total_minor_units" DECIMAL(1000,0),
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "card_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_invoices_card_id_owner_id_fkey"
    FOREIGN KEY ("card_id", "owner_id")
    REFERENCES "credit_cards"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "card_invoices_status_check"
    CHECK (
      ("status" = 'open' AND "closed_at" IS NULL AND "closed_total_minor_units" IS NULL)
      OR ("status" = 'closed' AND "closed_at" IS NOT NULL AND "closed_total_minor_units" >= 0)
    ),
  CONSTRAINT "card_invoices_dates_check"
    CHECK (
      "first_purchase_date" <= "last_purchase_date"
      AND "last_purchase_date" <= "closes_on"
      AND "scheduled_due_on" <= "due_on"
    ),
  CONSTRAINT "card_invoices_closing_boundary_check"
    CHECK ("closing_boundary" IN ('next-cycle', 'closing-cycle')),
  CONSTRAINT "card_invoices_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "card_invoices_id_owner_id_key"
  ON "card_invoices"("id", "owner_id");
CREATE UNIQUE INDEX "card_invoices_owner_id_card_id_closes_on_key"
  ON "card_invoices"("owner_id", "card_id", "closes_on");

-- A closed invoice never changes again.
CREATE FUNCTION "card_invoices_closed_is_final"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'closed card invoice % is immutable', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "card_invoices_closed_is_final"
  BEFORE UPDATE ON "card_invoices"
  FOR EACH ROW EXECUTE FUNCTION "card_invoices_closed_is_final"();
