-- Generic idempotency records for financial commands (RII-017, ADR-035).
CREATE TABLE "idempotency_records" (
    "owner_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "key" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "response" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("owner_id", "operation", "key"),
    CONSTRAINT "idempotency_records_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");
