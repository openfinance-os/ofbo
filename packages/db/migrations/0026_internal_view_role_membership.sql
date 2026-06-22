-- BACKOFFICE-33 (ADR 0015): the governed cross-fintech aggregation path drops to the
-- SELECT-only `bank_internal_view` role via `SET LOCAL ROLE bank_internal_view` so the
-- `internal_view_select` policies bypass per-tenant RLS. As with `ofbo_app` (migration 0008),
-- a true superuser (local/CI postgres) may SET ROLE freely, but on managed Postgres
-- (Supabase demo profile) the connection user is NOT a superuser and needs explicit
-- membership. Granted to the migration-running user, which is also the application's
-- connection user in every profile. Idempotent (GRANT re-runs are no-ops).
DO $$
BEGIN
  EXECUTE format('GRANT bank_internal_view TO %I', current_user);
EXCEPTION WHEN invalid_grant_operation THEN
  -- current_user IS bank_internal_view or a member loop — nothing to grant.
  NULL;
END $$;
