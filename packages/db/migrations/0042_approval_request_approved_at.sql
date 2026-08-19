-- BILL-16 — record WHEN an approval was approved, so the dispatch write path can verify the
-- four-eyes window independently of the primitive that opened it.
--
-- BILL-13's migration 0039 made this a BLOCKING obligation on BILL-16, in these words: "The cited
-- approval_request must be in state 'approved' and its expires_at must not have passed WHEN
-- APPROVED (2-hour adopting-bank default, PRD §10) — the foreign key constrains tenant and
-- existence only, because state and expiry are mutable on the referenced row."
--
-- That check was unenforceable as the schema stood. `approval_request` records `expires_at` (the
-- deadline) and `state`, but never the instant the approval happened — so a reader could see THAT
-- a request was approved and never WHETHER it was approved in time. The dispatch path could only
-- test `state === 'pending' && now > expires_at`, which catches an unsettled pending row and says
-- nothing about an approved one. The obligation asks for a check independent of
-- ApprovalsService.approve precisely because that service's own refusal is not evidence available
-- to a later reader.
--
-- Additive and nullable: existing rows predate the column and legitimately have no value. The
-- dispatch path treats a NULL on an approved row as unproven and REFUSES — for money movement the
-- absence of evidence is not evidence, and there is no live payable dispatch path today, so
-- failing closed costs nothing and starting permissive would have been a decision nobody made.
--
-- `approval_request` is one of the deliberately mutable tables (0003_rls.sql grants UPDATE on the
-- explicit mutable-table array), so stamping this on approval is consistent with how state,
-- approver and reject_reason are already written. It is not an audit row.

ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- An approved row must not claim it was approved after its own deadline. Enforced in SQL as well as
-- in the write path: the write path is the control the obligation names, this is the backstop that
-- survives a future caller that forgets it. NULL is permitted so the column stays additive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_approved_within_window'
  ) THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_approved_within_window
      CHECK (approved_at IS NULL OR approved_at <= expires_at);
  END IF;
END $$;
