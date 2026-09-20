CREATE TYPE "transaction_kind" AS ENUM ('income', 'expense');
CREATE TYPE "transaction_lifecycle" AS ENUM ('active', 'archived', 'trashed');

CREATE UNIQUE INDEX "accounts_id_owner_id_key" ON "accounts"("id", "owner_id");

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "transaction_kind" NOT NULL,
    "amount_minor_units" NUMERIC(1000,0) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "currency_minor_unit_scale" SMALLINT NOT NULL,
    "description" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "lifecycle" "transaction_lifecycle" NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "trashed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transactions_account_id_owner_id_fkey" FOREIGN KEY ("account_id", "owner_id") REFERENCES "accounts"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ck_transactions_amount_positive" CHECK ("amount_minor_units" > 0),
    CONSTRAINT "ck_transactions_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "ck_transactions_currency_scale" CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
    CONSTRAINT "ck_transactions_version_positive" CHECK ("version" > 0),
    CONSTRAINT "ck_transactions_lifecycle_timestamps" CHECK (
        ("lifecycle" = 'active' AND "archived_at" IS NULL AND "trashed_at" IS NULL)
        OR ("lifecycle" = 'archived' AND "archived_at" IS NOT NULL AND "trashed_at" IS NULL)
        OR ("lifecycle" = 'trashed' AND "trashed_at" IS NOT NULL)
    )
);

CREATE INDEX "transactions_owner_id_account_id_occurred_at_idx"
ON "transactions"("owner_id", "account_id", "occurred_at");
