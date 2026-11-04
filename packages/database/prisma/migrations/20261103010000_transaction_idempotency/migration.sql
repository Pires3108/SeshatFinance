CREATE TABLE "transaction_idempotency" (
  "owner_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "transaction_id" UUID NOT NULL,
  CONSTRAINT "transaction_idempotency_pkey" PRIMARY KEY ("owner_id", "key"),
  CONSTRAINT "transaction_idempotency_transaction_fkey" FOREIGN KEY ("transaction_id", "owner_id") REFERENCES "transactions"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "transaction_revisions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "previous_version" INTEGER NOT NULL,
  "new_version" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "transaction_revisions_transaction_fkey" FOREIGN KEY ("transaction_id", "owner_id") REFERENCES "transactions"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "transaction_revisions_transaction_version_key" ON "transaction_revisions"("transaction_id", "new_version");
CREATE INDEX "transaction_revisions_owner_transaction_version_idx" ON "transaction_revisions"("owner_id", "transaction_id", "new_version");
