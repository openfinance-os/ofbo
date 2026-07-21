-- HOST-02 (ADR 0027 / docs/proposals/multitenant-platform-blueprint.md D-1):
-- tenant groups + re-scope of the bank_internal_view cross-tenant read path.
--
-- WHY: bank_internal_view is the platform's one deliberate RLS-bypass role — its
-- `internal_view_select ... USING (true)` policies read across every bank_id
-- (0003_rls.sql). Designed for ONE bank aggregating across the fintechs it hosts
-- (ADR 0015), in a hosted multi-tenant deployment the SAME code path would read
-- across independent, competing CUSTOMERS. This migration scopes that bypass to the
-- caller's tenant group, so "cross-fintech within a customer" is preserved and
-- "cross-customer" is made impossible — the prerequisite before a second tenant exists.
--
-- BACKWARD-COMPATIBLE: with no group pinned (`app.tenant_group` unset) the policy reads
-- exactly as before (single-tenant default — the demo bank is the only bank, so USING(true)
-- returns only its rows). With a group pinned it is strictly group-scoped. Production
-- hardening (fail-closed when unpinned) is a follow-up once every tenant is guaranteed a
-- group membership (see ADR 0027 "Consequences").

-- Denormalized control-plane mapping. Every row is keyed by bank_id, so the standard
-- RLS-by-bank_id pattern applies uniformly; tenant_group_id groups the licensed entities of
-- one customer. A bank_id belongs to exactly one group (PRIMARY KEY on bank_id).
CREATE TABLE IF NOT EXISTS tenant_group_member (
  bank_id         uuid PRIMARY KEY,
  tenant_group_id uuid NOT NULL,
  group_slug      text NOT NULL,
  display_name    text NOT NULL,
  tier            text NOT NULL DEFAULT 'tier2' CHECK (tier IN ('tier1','tier2','insurer','longtail')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_group_member_group_idx ON tenant_group_member (tenant_group_id);

-- RLS ENABLE (not FORCE): this is operator control-plane config, written by the
-- provisioning/seed path as the connection owner (which the app connection user is in every
-- profile — see 0026). ofbo_app is a DIFFERENT role, so the SELECT policy still binds it.
-- No INSERT/UPDATE/DELETE is granted to ofbo_app — a tenant can never mutate the tenant map —
-- which also (by design) excludes this table from the retention/classification registries,
-- whose coverage is derived from ofbo_app INSERT grants (registry-coverage.int.spec).
ALTER TABLE tenant_group_member ENABLE ROW LEVEL SECURITY;

-- ofbo_app: a tenant sees ONLY its own membership row (RLS by bank_id, like every table).
DO $i$ BEGIN
  CREATE POLICY tenancy_select ON tenant_group_member FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;

-- bank_internal_view: must read membership to resolve a group's banks for the re-scoped
-- policy subquery below. Named DISTINCTLY (internal_view_membership, NOT internal_view_select)
-- so the re-scope loop does not rewrite it. Control-plane bank_id↔group mapping (non-PII).
DO $i$ BEGIN
  CREATE POLICY internal_view_membership ON tenant_group_member FOR SELECT TO bank_internal_view
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;

GRANT SELECT ON tenant_group_member TO ofbo_app, bank_internal_view;

-- Re-scope EVERY existing internal_view_select policy (across all regulated tables) to the
-- caller's pinned tenant group, with the single-tenant fallback described above.
DO $$
DECLARE
  r record;
  -- NULLIF(...,'')::uuid everywhere: a pooled connection retains an EMPTY-STRING value for a
  -- custom GUC after a transaction-local set_config reverts, and ''::uuid throws. This mirrors the
  -- app.bank_id policies in 0003_rls.sql. Empty/unset group → fallback read-all (single-tenant).
  scoped text := $u$(
    NULLIF(current_setting('app.tenant_group', true), '') IS NULL
    OR bank_id IN (
      SELECT m.bank_id FROM tenant_group_member m
      WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
    )
  )$u$;
BEGIN
  FOR r IN SELECT tablename FROM pg_policies WHERE policyname = 'internal_view_select' LOOP
    EXECUTE format('DROP POLICY internal_view_select ON %I', r.tablename);
    EXECUTE format(
      'CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING %s',
      r.tablename, scoped
    );
  END LOOP;
END $$;
