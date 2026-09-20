CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_tags_name_nonempty" CHECK (length(trim("name")) > 0),
    CONSTRAINT "ck_tags_version_positive" CHECK ("version" > 0)
);

CREATE INDEX "tags_owner_id_name_idx" ON "tags"("owner_id", "name");
