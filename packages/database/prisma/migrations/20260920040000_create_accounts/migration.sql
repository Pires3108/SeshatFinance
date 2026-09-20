CREATE TYPE "account_lifecycle" AS ENUM ('active', 'archived', 'trashed');

CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "institution" TEXT,
    "type_key" TEXT NOT NULL,
    "initial_balance_minor_units" NUMERIC(1000,0) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "currency_minor_unit_scale" SMALLINT NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "lifecycle" "account_lifecycle" NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "trashed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_accounts_name_nonempty" CHECK (length(trim("name")) > 0),
    CONSTRAINT "ck_accounts_type_key" CHECK ("type_key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
    CONSTRAINT "ck_accounts_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "ck_accounts_currency_scale" CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
    CONSTRAINT "ck_accounts_version_positive" CHECK ("version" > 0),
    CONSTRAINT "ck_accounts_lifecycle_timestamps" CHECK (
        ("lifecycle" = 'active' AND "archived_at" IS NULL AND "trashed_at" IS NULL)
        OR ("lifecycle" = 'archived' AND "archived_at" IS NOT NULL AND "trashed_at" IS NULL)
        OR ("lifecycle" = 'trashed' AND "trashed_at" IS NOT NULL)
    )
);

CREATE INDEX "accounts_owner_id_lifecycle_idx" ON "accounts"("owner_id", "lifecycle");
