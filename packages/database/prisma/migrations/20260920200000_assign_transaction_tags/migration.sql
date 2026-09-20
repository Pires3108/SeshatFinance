CREATE UNIQUE INDEX "transactions_id_owner_id_key" ON "transactions"("id", "owner_id");
CREATE UNIQUE INDEX "tags_id_owner_id_key" ON "tags"("id", "owner_id");

CREATE TABLE "transaction_tags" (
    "transaction_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_tags_pkey" PRIMARY KEY ("transaction_id", "tag_id"),
    CONSTRAINT "transaction_tags_transaction_id_owner_id_fkey"
        FOREIGN KEY ("transaction_id", "owner_id")
        REFERENCES "transactions"("id", "owner_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transaction_tags_tag_id_owner_id_fkey"
        FOREIGN KEY ("tag_id", "owner_id")
        REFERENCES "tags"("id", "owner_id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "transaction_tags_owner_id_tag_id_idx"
ON "transaction_tags"("owner_id", "tag_id");
