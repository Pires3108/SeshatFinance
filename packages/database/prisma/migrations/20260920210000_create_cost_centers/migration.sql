CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_centers_id_owner_id_key"
ON "cost_centers"("id", "owner_id");

CREATE INDEX "cost_centers_owner_id_name_idx"
ON "cost_centers"("owner_id", "name");
