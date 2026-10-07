CREATE TYPE "family_group_invitation_status" AS ENUM ('pending', 'accepted', 'revoked');
CREATE TABLE "family_group_invitations" (
  "id" UUID NOT NULL, "group_id" UUID NOT NULL, "invited_by" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL, "role" "family_group_role" NOT NULL,
  "token_hash" CHAR(64) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL, "status" "family_group_invitation_status" NOT NULL,
  "accepted_at" TIMESTAMPTZ(6), "accepted_user_id" UUID,
  CONSTRAINT "family_group_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_group_invitations_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "family_group_invitations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "family_group_invitations_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "family_group_invitations_group_id_status_expires_at_idx" ON "family_group_invitations"("group_id", "status", "expires_at");
CREATE INDEX "family_group_invitations_email_status_idx" ON "family_group_invitations"("email", "status");
