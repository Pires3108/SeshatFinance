CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_category_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_categories_name_nonempty" CHECK (length(trim("name")) > 0),
    CONSTRAINT "ck_categories_version_positive" CHECK ("version" > 0),
    CONSTRAINT "ck_categories_not_self_parent" CHECK ("parent_category_id" IS NULL OR "parent_category_id" <> "id")
);

CREATE UNIQUE INDEX "categories_id_owner_id_key" ON "categories"("id", "owner_id");
CREATE INDEX "categories_owner_id_parent_category_id_idx" ON "categories"("owner_id", "parent_category_id");

ALTER TABLE "categories"
ADD CONSTRAINT "categories_parent_category_id_owner_id_fkey"
FOREIGN KEY ("parent_category_id", "owner_id")
REFERENCES "categories"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
