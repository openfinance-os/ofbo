-- BACKOFFICE-35: self-service periodic report generation. CBUAE-bound reports are
-- four-eyes-gated on generation (awaiting_approval) and resolved via the report
-- :approve endpoint, which routes through the approvals service. The report carries
-- the approval_id so :approve (keyed by report_id) can resolve the right approval.
-- Additive column on the existing compliance_report table (RLS/retention/classification
-- already apply from 0002/0006/0007; lineage already covered).
ALTER TABLE compliance_report ADD COLUMN IF NOT EXISTS approval_id uuid;
