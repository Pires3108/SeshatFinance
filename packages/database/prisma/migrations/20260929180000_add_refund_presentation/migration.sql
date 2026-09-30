ALTER TABLE "user_profiles"
  ADD COLUMN "refund_presentation" VARCHAR(32) NOT NULL DEFAULT 'separate-income';

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_refund_presentation_check"
  CHECK ("refund_presentation" IN ('separate-income', 'expense-offset'));
