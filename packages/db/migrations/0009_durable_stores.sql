-- M1-DEMO-DEPLOY: durable stores for the four-eyes primitive and the
-- Idempotency-Key replay window. On Workers, in-memory state is per-isolate —
-- the contract behaviors (approval retrievability, 24h replay) must survive
-- isolate recycling, so they move to Postgres.

-- approval_request gains the execute-on-approve result (BACKOFFICE-44 wire field).
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS execution_result jsonb;

-- Idempotency replay cache. OPERATIONAL state, not a regulated record: entries
-- are meaningless past the 24h window, so deletion (pruning) is required —
-- which is exactly why this table is NOT in retention_policy (whose CHECK
-- forbids deletion_allowed). Classification metadata still applies
-- (BACKOFFICE-54: every record carries a class).
CREATE TABLE IF NOT EXISTS idempotency_key (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         uuid NOT NULL,
  channel         ofbo_channel NOT NULL,
  cache_key       text NOT NULL,
  response_status integer NOT NULL,
  response_body   jsonb NOT NULL,
  classification  ofbo_classification NOT NULL DEFAULT 'internal-confidential',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, cache_key)
);

ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE ROW LEVEL SECURITY;

DO $i$ BEGIN
  CREATE POLICY tenancy_select ON idempotency_key FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;

DO $i$ BEGIN
  CREATE POLICY tenancy_insert ON idempotency_key FOR INSERT TO ofbo_app
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;

-- Pruning expired replay entries is part of the contract (24h window), hence
-- DELETE — unique among Back Office tables, justified by the table's
-- operational (non-regulated) nature.
DO $i$ BEGIN
  CREATE POLICY tenancy_delete ON idempotency_key FOR DELETE TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;

GRANT SELECT, INSERT, DELETE ON idempotency_key TO ofbo_app;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('idempotency_key', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
