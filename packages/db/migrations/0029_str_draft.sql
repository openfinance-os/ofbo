-- BACKOFFICE-63: STR (Suspicious Transaction Report) draft persistence. A draft is
-- auto-created when a fraud-suspected revocation is approved (BACKOFFICE-22) and held by the
-- Back Office; Compliance hands an approved draft to the bank's STR workflow (P10), which
-- submits to the CBUAE AML GO portal — the Back Office never submits directly. RLS from day
-- one, retention + classification like every Back Office table; the store emits BCBS 239
-- lineage at write time. No PSU PII — an internal consent ref + case context only.

CREATE TABLE IF NOT EXISTS str_draft (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id            uuid NOT NULL,
  channel            ofbo_channel NOT NULL,
  source_consent_id  text NOT NULL,
  case_context       text NOT NULL,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_handoff','handed_off')),
  created_by         text NOT NULL,
  approval_id        text,
  workflow_ref       text,
  approved_by        text,
  handed_off_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — a draft progresses in place
-- draft → awaiting_handoff → handed_off), cross-bank SELECT for the aggregation role.
-- Mirrors 0025.
DO $$
DECLARE
  t text := 'str_draft';
BEGIN
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
END $$;

-- Retention: 24-month hot → 60-month immutable; deletion forbidden (BACKOFFICE-14).
INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('str_draft', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): STR case metadata — sensitive AML material, no PSU PII.
ALTER TABLE str_draft ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('str_draft', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
