-- US-051 / ADR-043 (RN-071): the declared reserve of an account. A reserve is
-- an organizational label: the book balance and the net worth stay the same
-- and nothing moves between accounts (INV-012, INV-013). A zero amount means
-- the reserve was removed; the row keeps its version history.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'account-reserve';

CREATE TABLE "account_reserves" (
  "account_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "account_reserves_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "account_reserves_account_id_owner_id_fkey"
    FOREIGN KEY ("account_id", "owner_id")
    REFERENCES "accounts"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_reserves_amount_check" CHECK ("amount_minor_units" >= 0),
  CONSTRAINT "account_reserves_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "account_reserves_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "account_reserves_account_id_owner_id_key"
  ON "account_reserves"("account_id", "owner_id");
CREATE INDEX "account_reserves_owner_id_idx" ON "account_reserves"("owner_id");
