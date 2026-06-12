-- M1-DEMO-DEPLOY: the audit/lineage emitters drop privileges with
-- SET LOCAL ROLE ofbo_app so RLS and the INSERT-only policies bind. A true
-- superuser (local/CI postgres) may SET ROLE freely, but on managed Postgres
-- (Supabase demo profile) the admin user is NOT a superuser and needs explicit
-- membership. Granted to the migration-running user, which is also the
-- application's connection user in every profile. Idempotent (GRANT re-runs
-- are no-ops).
DO $$
BEGIN
  EXECUTE format('GRANT ofbo_app TO %I', current_user);
EXCEPTION WHEN invalid_grant_operation THEN
  -- current_user IS ofbo_app or a member loop — nothing to grant.
  NULL;
END $$;
