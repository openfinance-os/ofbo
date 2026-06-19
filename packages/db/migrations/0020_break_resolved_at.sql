-- BACKOFFICE-09: the Reconciliation SLO dashboard needs break-resolution durations
-- (p50/p90, 30-day rolling). reconciliation_break tracks resolution_outcome but not
-- WHEN it resolved, so add resolved_at — set when a break is resolved (BACKOFFICE-04),
-- cleared on reopen. Additive column on an existing RLS/retention/classification-bound
-- table (0002/0003/0006/0007 already cover it); internal aggregation data, no contract
-- field, no PSU PII.

ALTER TABLE reconciliation_break ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
