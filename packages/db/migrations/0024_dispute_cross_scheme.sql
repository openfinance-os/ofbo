-- BACKOFFICE-76: cross-scheme (Aani / Al Tareq) dispute guard. Adds cross-scheme
-- context columns to dispute_case: the Aani case reference, the 2-hour fund-recall
-- window, the double-compensation guard (settled_in_other_scheme + compensation_blocked,
-- which blocks settling the same direct loss in both schemes), and Sanadak escalation.
-- Additive columns on an existing RLS/retention/classification-bound table (0002/0003/
-- 0006/0007 already cover dispute_case); internal case metadata, no PSU PII.

ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS aani_case_id                  text;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS aani_recall_window_expires_at timestamptz;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS settled_in_other_scheme       boolean NOT NULL DEFAULT false;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS compensation_blocked          boolean NOT NULL DEFAULT false;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS sanadak_reference             text;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS sanadak_escalated_at          timestamptz;
