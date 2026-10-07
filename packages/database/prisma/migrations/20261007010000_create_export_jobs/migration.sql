CREATE TYPE "export_job_format" AS ENUM ('json', 'csv', 'xlsx');
CREATE TYPE "export_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed', 'expired');

CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "format" "export_job_format" NOT NULL,
  "selection" JSONB NOT NULL,
  "filters" JSONB NOT NULL,
  "status" "export_job_status" NOT NULL DEFAULT 'queued',
  "progress" SMALLINT NOT NULL DEFAULT 0,
  "storage_key" TEXT,
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_progress_valid" CHECK ("progress" BETWEEN 0 AND 100),
  CONSTRAINT "export_jobs_expiry_valid" CHECK ("expires_at" = "created_at" + INTERVAL '24 hours')
);

CREATE UNIQUE INDEX "export_jobs_actor_id_idempotency_key_key"
  ON "export_jobs"("actor_id", "idempotency_key");
CREATE INDEX "export_jobs_actor_id_created_at_id_idx"
  ON "export_jobs"("actor_id", "created_at", "id");
CREATE INDEX "export_jobs_status_expires_at_idx"
  ON "export_jobs"("status", "expires_at");
