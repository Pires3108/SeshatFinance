ALTER TYPE "counterparty_status" RENAME TO "counterparty_status_old";
CREATE TYPE "counterparty_status" AS ENUM ('active', 'inactive', 'merged', 'eliminated');
ALTER TABLE "counterparties" DROP CONSTRAINT "counterparties_merge_state";
ALTER TABLE "counterparties" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "counterparties" ALTER COLUMN "status" TYPE "counterparty_status"
  USING "status"::text::"counterparty_status";
ALTER TABLE "counterparties" ALTER COLUMN "status" SET DEFAULT 'active';
DROP TYPE "counterparty_status_old";
ALTER TABLE "counterparties"
  ADD CONSTRAINT "counterparties_merge_state"
  CHECK (("status" = 'merged') = ("merged_into_id" IS NOT NULL));

ALTER TABLE "counterparties"
  ADD COLUMN "eliminated_at" TIMESTAMPTZ(6),
  ADD COLUMN "anonymized_at" TIMESTAMPTZ(6),
  ADD COLUMN "legal_hold" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "counterparties"
  ADD CONSTRAINT "counterparties_elimination_state"
  CHECK (("status" = 'eliminated') = ("eliminated_at" IS NOT NULL));

ALTER TABLE "counterparties"
  ADD CONSTRAINT "counterparties_anonymization_state"
  CHECK ("anonymized_at" IS NULL OR ("status" = 'eliminated' AND "anonymized_at" >= "eliminated_at" + INTERVAL '30 days'));

ALTER TABLE "transactions"
  ADD COLUMN "counterparty_id" UUID,
  ADD COLUMN "counterparty_name" VARCHAR(200),
  ADD CONSTRAINT "transactions_counterparty_exclusive"
  CHECK ("counterparty_id" IS NULL OR "counterparty_name" IS NULL),
  ADD CONSTRAINT "transactions_counterparty_id_owner_id_fkey"
  FOREIGN KEY ("counterparty_id", "owner_id") REFERENCES "counterparties"("id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "transactions_owner_id_counterparty_id_idx" ON "transactions"("owner_id", "counterparty_id");

CREATE FUNCTION counterparty_financial_link_count(link_owner_id UUID, link_counterparty_id UUID)
RETURNS BIGINT LANGUAGE SQL VOLATILE AS $$
  SELECT COUNT(*) FROM transactions
  WHERE owner_id = link_owner_id AND counterparty_id = link_counterparty_id;
$$;

CREATE FUNCTION resolve_transaction_counterparty() RETURNS trigger AS $$
DECLARE
  linked_status counterparty_status;
  redirect_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.counterparty_id IS NOT DISTINCT FROM OLD.counterparty_id
       AND NEW.counterparty_name IS NOT DISTINCT FROM OLD.counterparty_name THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.counterparty_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.counterparty_name IS NOT NULL THEN
    RAISE EXCEPTION 'Counterparty reference and free text are exclusive' USING ERRCODE = '23514';
  END IF;
  SELECT status, merged_into_id INTO linked_status, redirect_id
    FROM counterparties WHERE id = NEW.counterparty_id AND owner_id = NEW.owner_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned counterparty unavailable' USING ERRCODE = '23503';
  END IF;
  IF linked_status = 'merged' THEN
    NEW.counterparty_id := redirect_id;
    SELECT status INTO linked_status FROM counterparties
      WHERE id = NEW.counterparty_id AND owner_id = NEW.owner_id FOR SHARE;
  END IF;
  IF linked_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Counterparty unavailable for new link' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_resolve_counterparty
  BEFORE INSERT OR UPDATE OF counterparty_id, counterparty_name ON transactions
  FOR EACH ROW EXECUTE FUNCTION resolve_transaction_counterparty();
