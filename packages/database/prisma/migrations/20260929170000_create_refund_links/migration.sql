CREATE TYPE "refund_link_kind" AS ENUM ('refund', 'compensation');

CREATE TABLE "refund_links" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "expense_transaction_id" UUID NOT NULL,
  "entry_transaction_id" UUID NOT NULL,
  "kind" "refund_link_kind" NOT NULL,
  "compensates_refund_id" UUID,
  "request_fingerprint" CHAR(64) NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "refund_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_links_kind_check" CHECK (
    ("kind" = 'refund' AND "compensates_refund_id" IS NULL AND "reason" IS NULL)
    OR ("kind" = 'compensation' AND "compensates_refund_id" IS NOT NULL AND "reason" IS NOT NULL AND length(trim("reason")) > 0)
  )
);

CREATE UNIQUE INDEX "refund_links_id_owner_id_key" ON "refund_links"("id", "owner_id");
CREATE UNIQUE INDEX "refund_links_entry_transaction_id_owner_id_key" ON "refund_links"("entry_transaction_id", "owner_id");
CREATE UNIQUE INDEX "refund_links_owner_id_idempotency_key_key" ON "refund_links"("owner_id", "idempotency_key");
CREATE INDEX "refund_links_owner_id_expense_transaction_id_idx" ON "refund_links"("owner_id", "expense_transaction_id");
CREATE INDEX "refund_links_owner_id_compensates_refund_id_idx" ON "refund_links"("owner_id", "compensates_refund_id");

ALTER TABLE "refund_links" ADD CONSTRAINT "refund_links_expense_transaction_id_owner_id_fkey"
  FOREIGN KEY ("expense_transaction_id", "owner_id") REFERENCES "transactions"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_links" ADD CONSTRAINT "refund_links_entry_transaction_id_owner_id_fkey"
  FOREIGN KEY ("entry_transaction_id", "owner_id") REFERENCES "transactions"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_links" ADD CONSTRAINT "refund_links_compensates_refund_id_owner_id_fkey"
  FOREIGN KEY ("compensates_refund_id", "owner_id") REFERENCES "refund_links"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;
