-- Roles. Idempotent: duplicate_object swallowed.
-- ofbo_app          — the application role; sees only its bank_id partition (RLS).
-- bank_internal_view — cross-fintech aggregation role: SELECT-only across bank_id
--                      (PRD §5 cross-fintech aggregation control). Every use of it is
--                      governed by query_purpose_registry (BACKOFFICE-33, M4 wiring).
DO $$
BEGIN
  CREATE ROLE ofbo_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE bank_internal_view NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO ofbo_app, bank_internal_view;
