-- BACKOFFICE-75: respondent-side Nebras dispute scheme clocks. Distinct from the
-- PSU-raised dispute_case (BACKOFFICE-20/-21/-24): here the bank is the RESPONDENT
-- in a dispute Nebras raised against it, bound to scheme clocks (Interaction Guide
-- v4 / BD-16 defaults: response 3 bd, formal resolution 15 bd, appeal 3 bd of
-- verdict, implementation 3 bd of final verdict). Owned by Finance
-- (finance:disputes:write); the amber/red breach risk is surfaced to Compliance.
-- RLS from day one, retention + classification like every Back Office table; the
-- store emits BCBS 239 lineage at write time. No PSU PII (subject_summary is a
-- synthetic operator summary; redacted at audit emission like all bodies).

CREATE TABLE IF NOT EXISTS respondent_dispute (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  nebras_dispute_ref     text NOT NULL,
  category               text NOT NULL CHECK (category IN ('billing','consent','data_sharing','liability','conduct','other')),
  subject_summary        text,
  raised_at              timestamptz NOT NULL,
  originating_break_id   uuid,
  state                  text NOT NULL DEFAULT 'received'
                         CHECK (state IN ('received','responded','under_resolution','resolved','appealed','awaiting_implementation','implemented','closed')),
  response_due_at        timestamptz NOT NULL,
  responded_at           timestamptz,
  resolution_due_at      timestamptz NOT NULL,
  resolved_at            timestamptz,
  appeal_due_at          timestamptz,
  appealed_at            timestamptz,
  implementation_due_at  timestamptz,
  implemented_at         timestamptz,
  verdict_outcome        text CHECK (verdict_outcome IN ('upheld','partially_upheld','rejected')),
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — clocks advance in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0013.
DO $$
DECLARE
  t text := 'respondent_dispute';
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
  ('respondent_dispute', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): operational case metadata, no PSU PII.
ALTER TABLE respondent_dispute ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('respondent_dispute', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
