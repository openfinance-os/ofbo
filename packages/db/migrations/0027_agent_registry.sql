-- BACKOFFICE-60: agent DCR registry (ADR 0017). Programmatic admin-scope access for
-- internal automations. Each row is a registered automation identity bound to a
-- least-privilege agent persona whose scopes are a STRICT SUBSET of a human persona
-- (PRD §2) and never platform:superadmin (BACKOFFICE-80 — agents are service accounts).
-- Registration is four-eyes (the BFF gates it via the approvals primitive); the row is
-- created only on approval. status active → revoked (single-actor kill switch, a status
-- flip — granting authority needs two principals, removing it needs one).
-- RLS from day one, retention + classification like every Back Office table; the store
-- emits BCBS 239 lineage at write time. NO PSU PII — service-account metadata only.

CREATE TABLE IF NOT EXISTS agent_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         uuid NOT NULL,
  channel         ofbo_channel NOT NULL,
  client_id       text NOT NULL,
  display_name    text NOT NULL,
  persona         text NOT NULL,
  derived_from    text NOT NULL,
  scopes          text[] NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
  allow_mutations boolean NOT NULL DEFAULT false,
  spend_budget    integer NOT NULL DEFAULT 0 CHECK (spend_budget >= 0),
  registered_by   text NOT NULL,
  approved_by     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoke_reason   text
);

-- RLS: tenancy for ofbo_app (SELECT/INSERT/UPDATE — agents are revoked in place),
-- cross-bank SELECT for the aggregation role. Mirrors 0018.
DO $$
DECLARE
  t text := 'agent_registry';
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
  ('agent_registry', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

-- Classification (BACKOFFICE-54): agent registry metadata, no PSU PII.
ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'restricted';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('agent_registry', 'restricted')
ON CONFLICT (table_name) DO NOTHING;
