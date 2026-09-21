ALTER TABLE "transactions"
ADD COLUMN "category_id" UUID,
ADD COLUMN "subcategory_id" UUID,
ADD COLUMN "cost_center_id" UUID;

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_category_id_owner_id_fkey"
FOREIGN KEY ("category_id", "owner_id")
REFERENCES "categories"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "transactions_subcategory_id_owner_id_fkey"
FOREIGN KEY ("subcategory_id", "owner_id")
REFERENCES "categories"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "transactions_cost_center_id_owner_id_fkey"
FOREIGN KEY ("cost_center_id", "owner_id")
REFERENCES "cost_centers"("id", "owner_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "transactions_owner_id_category_id_idx"
ON "transactions"("owner_id", "category_id");

CREATE INDEX "transactions_owner_id_cost_center_id_idx"
ON "transactions"("owner_id", "cost_center_id");
