-- BACKOFFICE-77: Nebras fraud-incident reporting + scheme-imposed holds. Extends the
-- BACKOFFICE-22 fraud workflow with the "report to Nebras helpdesk" step: captures the
-- helpdesk case reference, maps the Nebras P1–P4 severity taxonomy to the ITSM (P3)
-- priority scheme (P1→critical, P2→high, P3→medium, P4→low), raises a P3 ticket, and
-- tracks the customer operational-pause state until resolution. Scheme-imposed holds
-- (systemic-fraud P1 events imposed on the bank) are flagged for the Ops + Risk Views.
-- RLS from day one, retention + classification like every Back Office table; the store
-- emits BCBS 239 lineage at write time. No PSU PII (summary is synthetic operator text,
-- redacted at audit emission).

CREATE TABLE IF NOT EXISTS fraud_incident (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  consent_id             uuid,
  client_id              uuid,
  nebras_severity        text NOT NULL CHECK (nebras_severity IN ('P1','P2','P3','P4')),
  itsm_priority          text NOT NULL CHECK (itsm_priority IN ('low','medium','high','critical')),
  nebras_case_reference  text,
  status                 text NOT NULL DEFAULT 'reported' CHECK (status IN ('open','reported','resolved')),
  operational_pause      boolean NOT NULL DEFAULT true,
  scheme_imposed_hold    boolean NOT NULL DEFAULT false,
  summary                text NOT NULL,
  opened_by              text NOT NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  reported_at            timestamptz,
  resolved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — incidents resolve in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0017.
DO $$
DECLARE
  t text := 'fraud_incident';
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
  ('fraud_incident', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): fraud case metadata, no PSU PII.
ALTER TABLE fraud_incident ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'restricted';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('fraud_incident', 'restricted')
ON CONFLICT (table_name) DO NOTHING;
