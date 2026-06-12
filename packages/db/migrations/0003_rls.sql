-- Row-level security from day one (CLAUDE.md stack default; PRD §5).
-- Tenancy: ofbo_app sees only rows where bank_id = current_setting('app.bank_id').
-- audit_high_sensitivity: INSERT-only — no UPDATE/DELETE policy at any role, privileges revoked.
-- bank_internal_view: SELECT-only across bank_id (cross-fintech aggregation, BACKOFFICE-33).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'reconciliation_log','reconciliation_break','dispute_case','audit_high_sensitivity',
    'compliance_report','risk_signal','approval_request','query_purpose_registry','tpp_counterparty'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- tenancy policies for ofbo_app
    EXECUTE format($p$
      DO $i$ BEGIN
        CREATE POLICY tenancy_select ON %I FOR SELECT TO ofbo_app
          USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
      EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
    $p$, t);
    EXECUTE format($p$
      DO $i$ BEGIN
        CREATE POLICY tenancy_insert ON %I FOR INSERT TO ofbo_app
          WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
      EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
    $p$, t);

    -- cross-bank SELECT for the aggregation role (and nothing else)
    EXECUTE format($p$
      DO $i$ BEGIN
        CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING (true);
      EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
    $p$, t);

    EXECUTE format('GRANT SELECT, INSERT ON %I TO ofbo_app', t);
    EXECUTE format('GRANT SELECT ON %I TO bank_internal_view', t);
  END LOOP;
END $$;

-- Mutable workflow tables get tenancy UPDATE for ofbo_app. The audit table does NOT.
DO $$
DECLARE
  t text;
  mutable text[] := ARRAY[
    'reconciliation_log','reconciliation_break','dispute_case',
    'compliance_report','risk_signal','approval_request','query_purpose_registry','tpp_counterparty'
  ];
BEGIN
  FOREACH t IN ARRAY mutable LOOP
    EXECUTE format($p$
      DO $i$ BEGIN
        CREATE POLICY tenancy_update ON %I FOR UPDATE TO ofbo_app
          USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid)
          WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
      EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
    $p$, t);
    EXECUTE format('GRANT UPDATE ON %I TO ofbo_app', t);
  END LOOP;
END $$;

-- INSERT-only audit: belt (no policy) AND braces (no privilege). No deletion path
-- for regulated records anywhere: DELETE is granted to no role on any regulated
-- table. (idempotency_key — an operational 24h replay cache outside
-- retention_policy — is the schema's one deletion path; see 0009.)
REVOKE UPDATE, DELETE ON audit_high_sensitivity FROM PUBLIC, ofbo_app, bank_internal_view;

GRANT SELECT ON consent_admin_event TO bank_internal_view;
