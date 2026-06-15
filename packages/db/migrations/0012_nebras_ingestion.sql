-- BACKOFFICE-32: Nebras TPP Reports + Dataset ingestion. Two tables:
--   nebras_ingest_snapshot   — the hot landing for each polled snapshot (rows +
--                              source publication time + freshness + warm-export
--                              state; the Parquet-on-object-storage warm copy is
--                              written by the enterprise warm-tier adapter at M6,
--                              keyed by warm_object_key).
--   nebras_report_aggregate  — materialized aggregates the M4 analytics views read
--                              (per period × channel × line_type), refreshed each run.
-- RLS from day one, retention + classification like every Back Office table; the
-- write paths emit BCBS 239 lineage. No PSU PII — synthetic ingest rows only.

CREATE TABLE IF NOT EXISTS nebras_ingest_snapshot (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id            uuid NOT NULL,
  channel            ofbo_channel NOT NULL,
  source             text NOT NULL CHECK (source IN ('tpp_reports','dataset')),
  dataset_name       text,
  period             text NOT NULL,
  run_id             text NOT NULL,
  published_at       timestamptz NOT NULL,
  row_count          integer NOT NULL DEFAULT 0,
  rows               jsonb NOT NULL DEFAULT '[]'::jsonb,
  freshness          text NOT NULL DEFAULT 'fresh' CHECK (freshness IN ('fresh','stale')),
  warm_export_state  text NOT NULL DEFAULT 'pending' CHECK (warm_export_state IN ('pending','exported','skipped')),
  warm_object_key    text,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, run_id)
);

CREATE TABLE IF NOT EXISTS nebras_report_aggregate (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id             uuid NOT NULL,
  channel             ofbo_channel NOT NULL,
  period              text NOT NULL,
  line_type           text NOT NULL,
  total_fee_minor     bigint NOT NULL DEFAULT 0,
  line_count          integer NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL DEFAULT 'AED',
  source_published_at timestamptz NOT NULL,
  refreshed_at        timestamptz NOT NULL DEFAULT now(),
  freshness           text NOT NULL DEFAULT 'fresh' CHECK (freshness IN ('fresh','stale')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, period, channel, line_type)
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — both refreshed in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0011.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['nebras_ingest_snapshot','nebras_report_aggregate'];
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
  ('nebras_ingest_snapshot', 24, 60),
  ('nebras_report_aggregate', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): synthetic Nebras report data, no PSU PII.
ALTER TABLE nebras_ingest_snapshot  ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE nebras_report_aggregate ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('nebras_ingest_snapshot', 'internal-confidential'),
  ('nebras_report_aggregate', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
