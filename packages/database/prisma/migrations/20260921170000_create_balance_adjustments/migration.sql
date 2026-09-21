CREATE TABLE "balance_adjustments" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "previous_balance_minor_units" DECIMAL(1000, 0) NOT NULL,
  "reported_balance_minor_units" DECIMAL(1000, 0) NOT NULL,
  "difference_minor_units" DECIMAL(1000, 0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "justification" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "balance_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "balance_adjustments_non_zero_difference_check"
    CHECK ("difference_minor_units" <> 0),
  CONSTRAINT "balance_adjustments_difference_check"
    CHECK (
      "reported_balance_minor_units" - "previous_balance_minor_units" =
      "difference_minor_units"
    ),
  CONSTRAINT "balance_adjustments_justification_check"
    CHECK (length(btrim("justification")) > 0)
);

CREATE UNIQUE INDEX "balance_adjustments_id_owner_id_key"
  ON "balance_adjustments"("id", "owner_id");
CREATE UNIQUE INDEX "balance_adjustments_transaction_id_owner_id_key"
  ON "balance_adjustments"("transaction_id", "owner_id");
CREATE INDEX "balance_adjustments_owner_id_account_id_created_at_idx"
  ON "balance_adjustments"("owner_id", "account_id", "created_at");

ALTER TABLE "balance_adjustments"
  ADD CONSTRAINT "balance_adjustments_account_id_owner_id_fkey"
  FOREIGN KEY ("account_id", "owner_id")
  REFERENCES "accounts"("id", "owner_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "balance_adjustments"
  ADD CONSTRAINT "balance_adjustments_transaction_id_owner_id_fkey"
  FOREIGN KEY ("transaction_id", "owner_id")
  REFERENCES "transactions"("id", "owner_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
