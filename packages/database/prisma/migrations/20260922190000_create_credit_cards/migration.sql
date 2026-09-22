CREATE TABLE "credit_cards" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "payment_account_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "limit_minor_units" DECIMAL(1000, 0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "closing_day" SMALLINT NOT NULL,
  "due_day" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "credit_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_cards_limit_non_negative" CHECK ("limit_minor_units" >= 0),
  CONSTRAINT "credit_cards_currency_scale_valid" CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "credit_cards_closing_day_valid" CHECK ("closing_day" BETWEEN 1 AND 31),
  CONSTRAINT "credit_cards_due_day_valid" CHECK ("due_day" BETWEEN 1 AND 31),
  CONSTRAINT "credit_cards_payment_account_fkey"
    FOREIGN KEY ("payment_account_id", "owner_id")
    REFERENCES "accounts"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "credit_cards_id_owner_id_key"
  ON "credit_cards"("id", "owner_id");

CREATE INDEX "credit_cards_owner_id_created_at_id_idx"
  ON "credit_cards"("owner_id", "created_at", "id");

CREATE INDEX "credit_cards_owner_id_payment_account_id_idx"
  ON "credit_cards"("owner_id", "payment_account_id");
