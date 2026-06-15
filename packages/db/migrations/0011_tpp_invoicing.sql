-- BACKOFFICE-73: monthly TPP invoicing — reconcile before invoice. Two mutable
-- workflow tables: billing_record_set (ingested Nebras monthly billing files) and
-- invoice_run (four-eyes-gated invoice runs to P9). RLS from day one, retention +
-- classification like every Back Office table; the write paths emit BCBS 239 lineage.

CREATE TABLE IF NOT EXISTS billing_record_set (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                   uuid NOT NULL,
  channel                   ofbo_channel NOT NULL,
  billing_period            text NOT NULL,
  ingested_by               text NOT NULL,
  source_note               text,
  integrity_hash            text NOT NULL,
  line_count                integer NOT NULL DEFAULT 0,
  status                    text NOT NULL DEFAULT 'ingested'
                            CHECK (status IN ('ingested','reconciling','reconciled_clean','reconciled_with_breaks')),
  open_break_count          integer NOT NULL DEFAULT 0,
  nebras_billing_query_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ingested_at               timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_run (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                       uuid NOT NULL,
  channel                       ofbo_channel NOT NULL,
  billing_period                text NOT NULL,
  record_set_id                 uuid NOT NULL,
  status                        text NOT NULL DEFAULT 'pending_approval'
                                CHECK (status IN ('pending_approval','approved','dispatched_to_p9','partially_settled','settled','rejected')),
  approval_id                   uuid,
  invoices                      jsonb NOT NULL DEFAULT '[]'::jsonb,
  withheld_line_count           integer NOT NULL DEFAULT 0,
  net_settlement_offset_amount  bigint,
  net_settlement_offset_currency char(3),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  CHECK ((net_settlement_offset_amount IS NULL) = (net_settlement_offset_currency IS NULL))
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — both are mutable workflow
-- tables), cross-bank SELECT for the aggregation role. Mirrors 0003.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['billing_record_set','invoice_run'];
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
  ('billing_record_set', 24, 60),
  ('invoice_run', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): every record carries a class + a policy floor.
ALTER TABLE billing_record_set ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE invoice_run        ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'confidential-restricted';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_record_set', 'internal-confidential'),
  ('invoice_run', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
