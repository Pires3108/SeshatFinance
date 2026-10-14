CREATE TABLE "transfer_idempotency_records" (
  "owner_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "response" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "transfer_idempotency_records_pkey" PRIMARY KEY ("owner_id", "key")
);
CREATE INDEX "transfer_idempotency_records_expires_at_idx" ON "transfer_idempotency_records" ("expires_at");
