-- US-042: days before the effective due date that flag an invoice for
-- attention. Default of 5 calendar days decided on 13/11/2026.

ALTER TABLE "credit_cards"
  ADD COLUMN "attention_days" SMALLINT NOT NULL DEFAULT 5;

ALTER TABLE "credit_cards"
  ADD CONSTRAINT "credit_cards_attention_days_check"
  CHECK ("attention_days" BETWEEN 0 AND 30);
