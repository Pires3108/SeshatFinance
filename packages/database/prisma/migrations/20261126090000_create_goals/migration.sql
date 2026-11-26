-- US-049 / ADR-043: goals and their linked account shares. Goals organize
-- progress only; nothing here records a transaction or changes a balance
-- (RN-033, INV-026). Shares are validated against the balance when declared
-- (RN-069) under a lock on the linked accounts.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'goal';

CREATE TABLE "goals" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "target_minor_units" DECIMAL(1000,0) NOT NULL,
  "initial_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  "deadline" DATE,
  "mode" VARCHAR(16) NOT NULL,
  "lifecycle" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goals_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "goals_target_check" CHECK ("target_minor_units" > 0),
  CONSTRAINT "goals_initial_check" CHECK ("initial_minor_units" >= 0),
  CONSTRAINT "goals_mode_check" CHECK ("mode" IN ('free', 'linked')),
  CONSTRAINT "goals_lifecycle_check"
    CHECK ("lifecycle" IN ('active', 'paused', 'archived')),
  CONSTRAINT "goals_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "goals_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "goals_id_owner_id_key" ON "goals"("id", "owner_id");
CREATE INDEX "goals_owner_id_created_at_idx" ON "goals"("owner_id", "created_at");

CREATE TABLE "goal_account_links" (
  "goal_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "position" SMALLINT NOT NULL,
  "share_kind" VARCHAR(16) NOT NULL,
  "share_minor_units" DECIMAL(1000,0),
  "share_currency_code" CHAR(3),
  "share_currency_minor_unit_scale" SMALLINT,
  CONSTRAINT "goal_account_links_pkey" PRIMARY KEY ("goal_id", "account_id"),
  CONSTRAINT "goal_account_links_goal_id_owner_id_fkey"
    FOREIGN KEY ("goal_id", "owner_id")
    REFERENCES "goals"("id", "owner_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "goal_account_links_account_id_owner_id_fkey"
    FOREIGN KEY ("account_id", "owner_id")
    REFERENCES "accounts"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goal_account_links_share_check"
    CHECK (
      ("share_kind" = 'full'
        AND "share_minor_units" IS NULL
        AND "share_currency_code" IS NULL
        AND "share_currency_minor_unit_scale" IS NULL)
      OR ("share_kind" = 'amount'
        AND "share_minor_units" > 0
        AND "share_currency_code" IS NOT NULL
        AND "share_currency_minor_unit_scale" BETWEEN 0 AND 18)
    ),
  CONSTRAINT "goal_account_links_position_check"
    CHECK ("position" BETWEEN 0 AND 19)
);

CREATE INDEX "goal_account_links_owner_id_account_id_idx"
  ON "goal_account_links"("owner_id", "account_id");
