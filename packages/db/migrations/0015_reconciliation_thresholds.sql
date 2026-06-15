-- BACKOFFICE-12: configurable break thresholds per fee class. The reconciliation
-- engine reads the current set at run time, so edits take effect on the NEXT run
-- and never retroactively (past runs are already computed + immutable). Each edit
-- is High-class audited (old/new values) and notifies Finance + Compliance.
-- One row per (bank_id, fee_class); unset classes fall back to the engine default.
-- RLS from day one, retention + classification like every Back Office table; writes
-- emit BCBS 239 lineage. No PSU PII (operational thresholds only).

CREATE TABLE IF NOT EXISTS reconciliation_threshold (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         uuid NOT NULL,
  channel         ofbo_channel NOT NULL,
  fee_class       text NOT NULL CHECK (fee_class IN ('nebras_fees','payment_settlement','consent_record','tpp_aas_pass_through','lfi_access_log')),
  threshold_value bigint NOT NULL CHECK (threshold_value >= 0),
  unit            text NOT NULL CHECK (unit IN ('aed','count')),
  updated_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, fee_class)
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — thresholds are upserted in
-- place), cross-bank SELECT for the aggregation role. Mirrors 0013.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['reconciliation_threshold'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_select ON %I FOR SELECT TO ofbo_app
        USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_insert ON %I FOR INSERT TO ofbo_app
        WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_update ON %I FOR UPDATE TO ofbo_app
        USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid)
        WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING (true);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO ofbo_app', t);
    EXECUTE format('GRANT SELECT ON %I TO bank_internal_view', t);
  END LOOP;
END $$;

-- Retention: 24-month hot → 60-month immutable; deletion forbidden (BACKOFFICE-14).
INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('reconciliation_threshold', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): operational metadata, no PSU PII.
ALTER TABLE reconciliation_threshold ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('reconciliation_threshold', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
