CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(120),
    "locale" VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "presentation_currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_user_profiles_locale_nonempty" CHECK (length(trim("locale")) > 0),
    CONSTRAINT "ck_user_profiles_time_zone_nonempty" CHECK (length(trim("time_zone")) > 0),
    CONSTRAINT "ck_user_profiles_currency_code" CHECK ("presentation_currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "ck_user_profiles_version_positive" CHECK ("version" > 0)
);
