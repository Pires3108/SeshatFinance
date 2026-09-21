CREATE TABLE "transfers" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "source_transaction_id" UUID NOT NULL,
  "destination_transaction_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfers_distinct_transactions_check"
    CHECK ("source_transaction_id" <> "destination_transaction_id")
);

CREATE UNIQUE INDEX "transfers_id_owner_id_key"
ON "transfers"("id", "owner_id");

CREATE UNIQUE INDEX "transfers_source_transaction_id_owner_id_key"
ON "transfers"("source_transaction_id", "owner_id");

CREATE UNIQUE INDEX "transfers_destination_transaction_id_owner_id_key"
ON "transfers"("destination_transaction_id", "owner_id");

CREATE INDEX "transfers_owner_id_created_at_idx"
ON "transfers"("owner_id", "created_at");

ALTER TABLE "transfers"
ADD CONSTRAINT "transfers_source_transaction_id_owner_id_fkey"
FOREIGN KEY ("source_transaction_id", "owner_id")
REFERENCES "transactions"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfers"
ADD CONSTRAINT "transfers_destination_transaction_id_owner_id_fkey"
FOREIGN KEY ("destination_transaction_id", "owner_id")
REFERENCES "transactions"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
