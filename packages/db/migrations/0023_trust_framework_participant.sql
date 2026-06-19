-- BACKOFFICE-74: Trust Framework participant administration. Registry of the bank's
-- own directory role-holders (Org Admin / PBC / PTC / STC) with named holders,
-- individual + organisational T&C/DocuSign status, a turnover workflow (departure →
-- replacement nomination), and per-onboarding-stage SLA tracking. RLS from day one,
-- retention + classification like every Back Office table; the store emits BCBS 239
-- lineage at write time. holder_display_name is an internal role-holder name
-- (operational), not PSU PII.

CREATE TABLE IF NOT EXISTS trust_framework_participant (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                     uuid NOT NULL,
  channel                     ofbo_channel NOT NULL,
  role                        text NOT NULL CHECK (role IN ('org_admin','pbc','ptc','stc')),
  organisation_id             text NOT NULL,
  holder_ref                  text NOT NULL,
  holder_display_name         text NOT NULL,
  onboarding_stage            text,
  individual_tnc_status       text NOT NULL DEFAULT 'not_started' CHECK (individual_tnc_status IN ('not_started','sent','signed','expired')),
  organisational_tnc_status   text NOT NULL DEFAULT 'not_started' CHECK (organisational_tnc_status IN ('not_started','sent','signed','expired')),
  onboarding_stage_due_at     timestamptz,
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','departing','vacant')),
  nominated_replacement_ref   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — turnover updates in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0018.
DO $$
DECLARE
  t text := 'trust_framework_participant';
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
  ('trust_framework_participant', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): directory administration metadata, no PSU PII.
ALTER TABLE trust_framework_participant ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('trust_framework_participant', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
