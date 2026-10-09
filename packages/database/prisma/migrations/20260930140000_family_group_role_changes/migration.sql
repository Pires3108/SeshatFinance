CREATE TABLE "family_group_role_changes" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "previous_role" "family_group_role" NOT NULL,
  "next_role" "family_group_role" NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "family_group_role_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_group_role_changes_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "family_group_role_changes_group_id_changed_at_id_idx"
  ON "family_group_role_changes"("group_id", "changed_at", "id");

CREATE OR REPLACE FUNCTION reject_family_group_role_change_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Family group role changes are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER family_group_role_changes_append_only
BEFORE UPDATE OR DELETE ON "family_group_role_changes"
FOR EACH ROW EXECUTE FUNCTION reject_family_group_role_change_mutation();
