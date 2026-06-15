-- BACKOFFICE-28: Operations Console substrate. Two tables the platform-health
-- view reads:
--   platform_certification — certification status PER ROLE (LFI path: Sandbox →
--                            Pre-Prod CX → Prod → Live-Proving ≥2 TPPs; TPP path:
--                            FAPI RP cert per app + Functional + CX + Live-Proving
--                            ≥1 LFI). Verbatim scheme tracks (PRD §7 BACKOFFICE-28).
--   platform_outage       — active/resolved platform outages for the Ops Console.
-- The TPP onboarding pipeline + onboarding-handover health + Nebras connectivity
-- are composed from existing sources (tpp_counterparty, P8, nebras_ingest_snapshot).
-- RLS from day one, retention + classification like every Back Office table; the
-- seed emits BCBS 239 lineage. No PSU PII.

CREATE TABLE IF NOT EXISTS platform_certification (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id           uuid NOT NULL,
  channel           ofbo_channel NOT NULL,
  role              text NOT NULL CHECK (role IN ('LFI','TPP')),
  subject           text NOT NULL,
  track             text NOT NULL,
  current_stage     text NOT NULL,
  stages_total      integer NOT NULL DEFAULT 0,
  stages_completed  integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','certified','live_proving','live')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, role, subject)
);

CREATE TABLE IF NOT EXISTS platform_outage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id      uuid NOT NULL,
  channel      ofbo_channel NOT NULL,
  title        text NOT NULL,
  component    text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info','minor','major','critical')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — certification progresses and
-- outages resolve in place), cross-bank SELECT for the aggregation role. Mirrors 0012.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['platform_certification','platform_outage'];
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
  ('platform_certification', 24, 60),
  ('platform_outage', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): operational metadata, no PSU PII.
ALTER TABLE platform_certification ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE platform_outage        ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('platform_certification', 'internal-confidential'),
  ('platform_outage', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
