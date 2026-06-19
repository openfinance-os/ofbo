-- BACKOFFICE-79: Nebras service-desk case tracking. Any case raised with the Nebras
-- service desk (incident, billing query, onboarding, general) tracked by Nebras case
-- reference with type, priority, and the Interaction-Guide SLA, optionally linked to the
-- originating break / dispute / risk signal. RLS from day one, retention + classification
-- like every Back Office table; the store emits BCBS 239 lineage at write time. No PSU PII.

CREATE TABLE IF NOT EXISTS service_desk_case (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  nebras_case_reference  text NOT NULL,
  case_type              text NOT NULL CHECK (case_type IN ('incident','billing_query','onboarding','general')),
  priority               text NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','awaiting_nebras','resolved','closed')),
  summary                text NOT NULL,
  sla_due_at             timestamptz NOT NULL,
  linked_break_id        uuid,
  linked_dispute_id      uuid,
  linked_signal_id       uuid,
  opened_by              text NOT NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — cases progress in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0023.
DO $$
DECLARE
  t text := 'service_desk_case';
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
  ('service_desk_case', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): operational case metadata, no PSU PII.
ALTER TABLE service_desk_case ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('service_desk_case', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
