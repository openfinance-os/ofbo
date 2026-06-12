-- BACKOFFICE-80: the superadmin marker is recorded on every High-class audit
-- record as a first-class column, and Compliance gets a pre-built monthly
-- review of super-admin activity (guardrail e).

ALTER TABLE audit_high_sensitivity
  ADD COLUMN IF NOT EXISTS superadmin_marker boolean NOT NULL DEFAULT false;

-- security_invoker: the underlying table's FORCE RLS applies to the querying role.
CREATE OR REPLACE VIEW superadmin_activity_review
  WITH (security_invoker = true) AS
SELECT
  date_trunc('month', created_at) AS month,
  bank_id,
  acting_principal,
  event_type,
  count(*) AS event_count
FROM audit_high_sensitivity
WHERE superadmin_marker
GROUP BY 1, 2, 3, 4;

GRANT SELECT ON superadmin_activity_review TO ofbo_app, bank_internal_view;
