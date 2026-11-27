-- US-055 / ADR-044: declared investment events. An aporte or resgate with an
-- account writes one linked account entry in the same transaction; that entry
-- changes the book balance but is neither income nor expense. Income events
-- with an account write a linked income. Fees and taxes never touch an
-- account. Nothing is executed outside Seshat Finance.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'investment-event';

CREATE TABLE "investment_events" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "investment_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "amount_minor_units" DECIMAL(1000, 0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "quantity" DECIMAL(38, 8),
  "unit_price" DECIMAL(38, 8),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "occurred_on" DATE NOT NULL,
  "account_id" UUID,
  "transaction_id" UUID,
  "note" VARCHAR(500),
  "lifecycle" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "investment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investment_events_kind_check" CHECK ("kind" IN (
    'contribution', 'redemption', 'yield', 'dividend', 'interest', 'fee', 'tax'
  )),
  CONSTRAINT "investment_events_amount_check" CHECK ("amount_minor_units" > 0),
  CONSTRAINT "investment_events_currency_check" CHECK (
    "currency_code" ~ '^[A-Z]{3}$'
    AND "currency_minor_unit_scale" BETWEEN 0 AND 8
  ),
  CONSTRAINT "investment_events_quantity_check" CHECK (
    ("quantity" IS NULL OR ("quantity" > 0 AND "kind" IN ('contribution', 'redemption')))
    AND ("unit_price" IS NULL OR ("unit_price" > 0 AND "quantity" IS NOT NULL))
  ),
  CONSTRAINT "investment_events_account_check" CHECK (
    ("account_id" IS NULL) = ("transaction_id" IS NULL)
    AND ("account_id" IS NULL OR "kind" NOT IN ('fee', 'tax'))
  ),
  CONSTRAINT "investment_events_lifecycle_check"
    CHECK ("lifecycle" IN ('active', 'trashed')),
  CONSTRAINT "investment_events_version_check" CHECK ("version" >= 1),
  CONSTRAINT "investment_events_investment_fkey"
    FOREIGN KEY ("investment_id", "owner_id")
    REFERENCES "investments" ("id", "owner_id") ON DELETE RESTRICT,
  CONSTRAINT "investment_events_account_fkey"
    FOREIGN KEY ("account_id", "owner_id")
    REFERENCES "accounts" ("id", "owner_id") ON DELETE RESTRICT,
  CONSTRAINT "investment_events_transaction_fkey"
    FOREIGN KEY ("transaction_id", "owner_id")
    REFERENCES "transactions" ("id", "owner_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "investment_events_id_owner_id_key"
  ON "investment_events" ("id", "owner_id");
CREATE UNIQUE INDEX "investment_events_transaction_id_key"
  ON "investment_events" ("transaction_id");
CREATE UNIQUE INDEX "investment_events_transaction_id_owner_id_key"
  ON "investment_events" ("transaction_id", "owner_id");
CREATE INDEX "investment_events_owner_id_investment_id_occurred_on_idx"
  ON "investment_events" ("owner_id", "investment_id", "occurred_on");
