-- ADR 0022: Integration Readiness Wizard — named profile persistence.
-- This is the FIRST non-tenanted Back Office table, and deliberately so: it stores PUBLIC,
-- pre-sale self-assessments (bank SYSTEM METADATA — "we use Okta") with NO bank_id, NO channel,
-- NO PSU data, NO PII. It is NEVER a regulated record and NEVER audit_high_sensitivity.
-- RLS is still enabled + forced (CLAUDE.md "RLS from day one"), but with a PUBLIC policy
-- (USING (true)) because there is no tenant pre-sale — justified by the non-regulated nature.
-- Keyed by an unguessable slug (the share token), not by any identity.

CREATE TABLE IF NOT EXISTS readiness_profile (
  slug         text PRIMARY KEY,
  name         text NOT NULL,
  input        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t text := 'readiness_profile';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  -- PUBLIC policy: no tenancy dimension exists for a pre-sale prospect. Read + insert only;
  -- profiles are immutable once saved (reopen-by-slug, never mutate). No DELETE policy.
  EXECUTE format($p$
    CREATE POLICY public_select ON %I FOR SELECT TO ofbo_app USING (true);
  $p$, t);
  EXECUTE format($p$
    CREATE POLICY public_insert ON %I FOR INSERT TO ofbo_app WITH CHECK (true);
  $p$, t);
  EXECUTE format('GRANT SELECT, INSERT ON %I TO ofbo_app', t);
END $$;

-- Governance enrolment (BACKOFFICE-50 / -54): every writable table is enrolled in the retention
-- and classification registries, no exceptions — the registry-coverage gate enforces it. This
-- table is non-regulated and carries no PII, but "which bank evaluates OFBO on which vendors" is
-- commercially sensitive, so it takes the lowest available classification floor and the standard
-- 24/60/no-deletion posture (it is immutable + reopen-only anyway — no DELETE policy above).
INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('readiness_profile', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

ALTER TABLE readiness_profile ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
INSERT INTO classification_policy (table_name, floor) VALUES
  ('readiness_profile', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
