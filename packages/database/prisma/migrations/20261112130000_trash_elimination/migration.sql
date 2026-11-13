-- US-034 / RII-026 option (b): permanent elimination is a terminal state,
-- not a physical delete. Revisions, links and the audit trail stay intact;
-- eliminated rows are hidden from every ordinary read and from the trash.

ALTER TYPE "financial_audit_action" ADD VALUE 'eliminated';

ALTER TABLE "transactions"
  ADD COLUMN "eliminated_at" TIMESTAMPTZ(6);

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_eliminated_only_from_trash_check"
  CHECK (
    "eliminated_at" IS NULL
    OR (
      "lifecycle" = 'trashed'
      AND "trashed_at" IS NOT NULL
      AND "eliminated_at" >= "trashed_at"
    )
  );

-- Supports the retention scan for items in the trash beyond 30 days.
CREATE INDEX "transactions_trash_retention_idx"
  ON "transactions"("trashed_at")
  WHERE "lifecycle" = 'trashed' AND "eliminated_at" IS NULL;
