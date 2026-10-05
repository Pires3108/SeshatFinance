CREATE TABLE "authentication_attempt_limits" (
    "identity_hash" CHAR(64) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "lockout_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "authentication_attempt_limits_pkey" PRIMARY KEY ("identity_hash"),
    CONSTRAINT "authentication_attempt_limits_nonnegative" CHECK ("failed_attempts" >= 0 AND "lockout_count" >= 0)
);
