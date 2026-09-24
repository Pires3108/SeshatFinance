CREATE TYPE "family_group_role" AS ENUM ('owner', 'administrator', 'member', 'viewer');

CREATE TABLE "family_groups" (
  "id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "family_group_memberships" (
  "group_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "family_group_role" NOT NULL,
  "joined_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "family_group_memberships_pkey" PRIMARY KEY ("group_id", "user_id"),
  CONSTRAINT "family_group_memberships_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "family_group_memberships_user_id_joined_at_group_id_idx"
  ON "family_group_memberships"("user_id", "joined_at", "group_id");

CREATE UNIQUE INDEX "family_group_memberships_single_owner_idx"
  ON "family_group_memberships"("group_id")
  WHERE "role" = 'owner';
