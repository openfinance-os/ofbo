-- BACKOFFICE-54: data-classification metadata on every record.
-- Vocabulary (PRD §7.4): internal-confidential / confidential-restricted / restricted.
-- Mismatches (records below their table's floor) are surfaced by the
-- classification validator and trigger Compliance review (Risk/ITSM wiring at M4).

DO $$
BEGIN
  CREATE DOMAIN ofbo_classification AS text
    CHECK (VALUE IN ('internal-confidential', 'confidential-restricted', 'restricted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Per-table defaults reflect PRD §5 audit postures.
ALTER TABLE reconciliation_log      ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE reconciliation_break    ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE dispute_case            ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'confidential-restricted';
ALTER TABLE audit_high_sensitivity  ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'restricted';
ALTER TABLE risk_signal             ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'confidential-restricted';
ALTER TABLE approval_request        ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE query_purpose_registry  ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE tpp_counterparty        ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
ALTER TABLE lineage_events          ADD COLUMN IF NOT EXISTS classification ofbo_classification NOT NULL DEFAULT 'internal-confidential';
-- compliance_report has carried its own classification column (same vocabulary) since 0002.

-- Classification floors: the MINIMUM class a record in each table may carry.
CREATE TABLE IF NOT EXISTS classification_policy (
  table_name  text PRIMARY KEY,
  floor       ofbo_classification NOT NULL
);

INSERT INTO classification_policy (table_name, floor) VALUES
  ('reconciliation_log', 'internal-confidential'),
  ('reconciliation_break', 'internal-confidential'),
  ('dispute_case', 'confidential-restricted'),
  ('audit_high_sensitivity', 'restricted'),
  ('compliance_report', 'confidential-restricted'),
  ('risk_signal', 'confidential-restricted'),
  ('approval_request', 'internal-confidential'),
  ('query_purpose_registry', 'internal-confidential'),
  ('tpp_counterparty', 'internal-confidential'),
  ('lineage_events', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;

GRANT SELECT ON classification_policy TO ofbo_app, bank_internal_view;
REVOKE INSERT, UPDATE, DELETE ON classification_policy FROM PUBLIC, ofbo_app, bank_internal_view;
