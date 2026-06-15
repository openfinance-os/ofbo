-- BACKOFFICE-24: complaint/dispute case-management lifecycle. dispute_case already
-- carries the state machine (open→in_progress→escalated→refund_initiated→resolved→
-- closed) + sla_clock_started_at; this slice adds the lifecycle metadata the state-
-- transition path records. Additive columns only — RLS, retention (0006) and
-- classification (0007) already bind dispute_case (row-level RLS + per-table policy
-- cover new columns), and ofbo_app already holds UPDATE (the refund path mutates).
-- No PSU PII in the new columns (escalated_to is an internal team/queue; resolution_note
-- is operator-entered free text — High-class audited, redacted at emission like all bodies).

ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS escalated_to     text;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS resolution_note  text;
ALTER TABLE dispute_case ADD COLUMN IF NOT EXISTS state_changed_at timestamptz;
