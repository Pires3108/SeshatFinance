-- US-038 / RII-015: card closing boundary, optimistic version and the
-- holder location and declared holidays used to shift card due dates.

ALTER TABLE "credit_cards"
  ADD COLUMN "closing_boundary" VARCHAR(16) NOT NULL DEFAULT 'next-cycle',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "credit_cards"
  ADD CONSTRAINT "credit_cards_closing_boundary_check"
  CHECK ("closing_boundary" IN ('next-cycle', 'closing-cycle')),
  ADD CONSTRAINT "credit_cards_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "credit_cards_cycle_days_check"
  CHECK ("closing_day" BETWEEN 1 AND 31 AND "due_day" BETWEEN 1 AND 31);

CREATE TABLE "user_holiday_settings" (
  "owner_id" UUID NOT NULL,
  "state_code" CHAR(2),
  "municipality_code" CHAR(7),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_holiday_settings_pkey" PRIMARY KEY ("owner_id"),
  CONSTRAINT "user_holiday_settings_municipality_requires_state_check"
    CHECK ("municipality_code" IS NULL OR "state_code" IS NOT NULL),
  CONSTRAINT "user_holiday_settings_municipality_format_check"
    CHECK ("municipality_code" IS NULL OR "municipality_code" ~ '^[0-9]{7}$')
);

CREATE TABLE "user_declared_holidays" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "month" SMALLINT NOT NULL,
  "day" SMALLINT NOT NULL,
  "year" SMALLINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_declared_holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_declared_holidays_date_check"
    CHECK ("month" BETWEEN 1 AND 12 AND "day" BETWEEN 1 AND 31),
  CONSTRAINT "user_declared_holidays_name_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX "user_declared_holidays_id_owner_id_key"
  ON "user_declared_holidays"("id", "owner_id");
CREATE INDEX "user_declared_holidays_owner_id_month_day_idx"
  ON "user_declared_holidays"("owner_id", "month", "day");
