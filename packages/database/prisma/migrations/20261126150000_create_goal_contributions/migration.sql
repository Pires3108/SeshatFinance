-- US-050 / ADR-043 (RN-070): an eligible entry (income or incoming side of a
-- transfer) split between goals. The entry keeps its full value in the
-- balance (INV-026); the lines never exceed it (INV-025), checked under a
-- lock on the entry row. Lines stay when the entry goes to the trash.

ALTER TYPE "financial_audit_resource_type" ADD VALUE 'goal-contribution';

CREATE TABLE "goal_contribution_sources" (
  "source_transaction_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL,
  CONSTRAINT "goal_contribution_sources_pkey" PRIMARY KEY ("source_transaction_id"),
  CONSTRAINT "goal_contribution_sources_transaction_fkey"
    FOREIGN KEY ("source_transaction_id", "owner_id")
    REFERENCES "transactions"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goal_contribution_sources_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "goal_contribution_sources_source_transaction_id_owner_id_key"
  ON "goal_contribution_sources"("source_transaction_id", "owner_id");
CREATE INDEX "goal_contribution_sources_owner_id_idx"
  ON "goal_contribution_sources"("owner_id");

CREATE TABLE "goal_contributions" (
  "source_transaction_id" UUID NOT NULL,
  "goal_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "position" SMALLINT NOT NULL,
  "amount_minor_units" DECIMAL(1000,0) NOT NULL,
  "currency_code" CHAR(3) NOT NULL,
  "currency_minor_unit_scale" SMALLINT NOT NULL,
  CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("source_transaction_id", "goal_id"),
  CONSTRAINT "goal_contributions_source_fkey"
    FOREIGN KEY ("source_transaction_id", "owner_id")
    REFERENCES "goal_contribution_sources"("source_transaction_id", "owner_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "goal_contributions_goal_fkey"
    FOREIGN KEY ("goal_id", "owner_id")
    REFERENCES "goals"("id", "owner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goal_contributions_amount_check" CHECK ("amount_minor_units" > 0),
  CONSTRAINT "goal_contributions_currency_scale_check"
    CHECK ("currency_minor_unit_scale" BETWEEN 0 AND 18),
  CONSTRAINT "goal_contributions_position_check" CHECK ("position" BETWEEN 0 AND 19)
);

CREATE INDEX "goal_contributions_owner_id_goal_id_idx"
  ON "goal_contributions"("owner_id", "goal_id");
