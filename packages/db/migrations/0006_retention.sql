-- BACKOFFICE-50: retention lifecycle made queryable and binding in data.
-- 24-month hot → columnar warm storage → 5-year (60-month) immutable;
-- deletion_allowed is false for every regulated table — there is NO deletion
-- path; the warm-tier mover (Parquet export) lands with the analytics service.

CREATE TABLE IF NOT EXISTS retention_policy (
  table_name        text PRIMARY KEY,
  hot_months        integer NOT NULL,
  immutable_months  integer NOT NULL,
  deletion_allowed  boolean NOT NULL DEFAULT false,
  CHECK (deletion_allowed = false) -- regulated records: the column exists to make the posture explicit
);

INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('reconciliation_log', 24, 60),
  ('reconciliation_break', 24, 60),
  ('dispute_case', 24, 60),
  ('audit_high_sensitivity', 24, 60),
  ('compliance_report', 24, 60),
  ('risk_signal', 24, 60),
  ('approval_request', 24, 60),
  ('query_purpose_registry', 24, 60),
  ('tpp_counterparty', 24, 60),
  ('lineage_events', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

GRANT SELECT ON retention_policy TO ofbo_app, bank_internal_view;
REVOKE INSERT, UPDATE, DELETE ON retention_policy FROM PUBLIC, ofbo_app, bank_internal_view;
