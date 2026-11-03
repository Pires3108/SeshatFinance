CREATE TYPE "counterparty_type" AS ENUM ('person', 'company', 'institution');
CREATE TYPE "counterparty_status" AS ENUM ('active', 'inactive', 'merged');

CREATE TABLE "counterparties" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "type" "counterparty_type" NOT NULL,
  "email" VARCHAR(254),
  "phone" VARCHAR(40),
  "document" VARCHAR(40),
  "notes" VARCHAR(2000),
  "status" "counterparty_status" NOT NULL DEFAULT 'active',
  "merged_into_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "counterparties_id_owner_id_key" UNIQUE ("id", "owner_id"),
  CONSTRAINT "counterparties_merge_not_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id"),
  CONSTRAINT "counterparties_merge_state" CHECK (("status" = 'merged') = ("merged_into_id" IS NOT NULL)),
  CONSTRAINT "counterparties_merged_into_id_owner_id_fkey" FOREIGN KEY ("merged_into_id", "owner_id") REFERENCES "counterparties"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "counterparties_owner_id_status_name_idx" ON "counterparties"("owner_id", "status", "name");
