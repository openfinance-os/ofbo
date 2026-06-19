-- BACKOFFICE-78: outbound downtime/change notifications to Nebras. Planned bank
-- maintenance / version releases must notify Nebras >=10 days in advance; breaking
-- changes require 30 days + a dual-running checklist (mitigates the AED 5,000 liability
-- class BACKOFFICE-36 only monitors). Each notification carries its notice-clock
-- compliance, Nebras acknowledgment, and downstream-TPP propagation flag. RLS from day
-- one, retention + classification like every Back Office table; the store emits BCBS 239
-- lineage at write time. No PSU PII (title/description are operational change text).

CREATE TABLE IF NOT EXISTS scheme_notification (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  notification_type      text NOT NULL CHECK (notification_type IN ('planned_maintenance','version_release','breaking_change')),
  title                  text NOT NULL,
  description            text,
  scheduled_start        timestamptz NOT NULL,
  scheduled_end          timestamptz NOT NULL,
  notice_required_days   integer NOT NULL,
  notified_at            timestamptz,
  notice_deadline        timestamptz NOT NULL,
  notice_compliant       boolean NOT NULL,
  dual_running_required   boolean NOT NULL DEFAULT false,
  dual_running_complete   boolean NOT NULL DEFAULT false,
  acknowledged           boolean NOT NULL DEFAULT false,
  acknowledged_at        timestamptz,
  nebras_ack_reference   text,
  propagate_to_tpp       boolean NOT NULL DEFAULT true,
  status                 text NOT NULL DEFAULT 'notified' CHECK (status IN ('draft','notified','acknowledged','completed')),
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — acknowledgment lands in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0018.
DO $$
DECLARE
  t text := 'scheme_notification';
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

-- Retention: 24-month hot -> 60-month immutable; deletion forbidden (BACKOFFICE-14).
INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('scheme_notification', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): operational change metadata, no PSU PII.
ALTER TABLE scheme_notification ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('scheme_notification', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
