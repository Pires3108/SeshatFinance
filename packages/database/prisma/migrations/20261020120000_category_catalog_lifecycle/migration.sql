ALTER TABLE "categories" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE TABLE "category_catalog_installations" (
    "owner_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "category_catalog_installations_pkey" PRIMARY KEY ("owner_id"),
    CONSTRAINT "ck_category_catalog_version_positive" CHECK ("version" > 0)
);
