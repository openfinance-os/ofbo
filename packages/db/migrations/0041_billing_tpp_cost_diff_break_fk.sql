-- ---------------------------------------------------------------------------------------------
-- BILL-15 criterion 6(b) — constrain billing_tpp_cost_diff_line.reconciliation_break_id.
--
-- BILL-13 created the column with NO foreign key and forbade writing it, because a tenant-composite
-- FK needs two decisions that BILL-13 was not the right story to make:
--
--   1. a new UNIQUE (bank_id, id) on reconciliation_break — an E1 table, not a payables table; and
--   2. ON DELETE semantics for a regulated record.
--
-- Both are settled here, and BILL-15 is the story that first writes the column.
--
-- (1) The UNIQUE is additive and constrains nothing new. `id` is already the PRIMARY KEY, so it is
--     unique on its own; adding `bank_id` in front cannot admit or reject a row that the primary key
--     did not already decide. Its only purpose is to give the composite FK a target, which is what
--     forces every reference to carry the tenant and makes a cross-tenant reference unrepresentable
--     rather than merely prevented by RLS. This is the ADR 0028 idiom, matching the composite FK
--     0039 added against approval_request.
--
-- (2) ON DELETE is deliberately absent, which means NO ACTION: deleting a referenced break is
--     REFUSED. For a table with a 5-year immutable retention obligation and no deletion path, the
--     alternatives are all wrong — CASCADE would let one delete propagate into the payables ledger,
--     and SET NULL would silently sever the link between a payable variance and the break it was
--     raised as, destroying the audit trail while reporting success. Refusal is the only outcome
--     consistent with the retention rule, and it is the default precisely so it need not be argued
--     for at every reference.
--
-- MATCH SIMPLE (the default) is load-bearing here and easy to misread. `reconciliation_break_id` is
-- nullable while `bank_id` is NOT NULL, so a row with a NULL break id satisfies the constraint
-- without any lookup: the reference stays optional, which it must, since a diff line is written at
-- reconciliation time and only some lines are escalated into an E1 break. When the id IS present,
-- both columns are non-null and the FK is enforced in full.
--
-- Additive and backfill-free: BILL-13 forbade writing the column, so every existing row has it NULL
-- and no existing row can violate the new constraint.
-- ---------------------------------------------------------------------------------------------

-- Guarded because Postgres has no ADD CONSTRAINT IF NOT EXISTS, matching the defensive style of 0039.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_break_bank_scoped_key'
  ) THEN
    ALTER TABLE reconciliation_break
      ADD CONSTRAINT reconciliation_break_bank_scoped_key UNIQUE (bank_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_tpp_cost_diff_line_break_fkey'
  ) THEN
    ALTER TABLE billing_tpp_cost_diff_line
      ADD CONSTRAINT billing_tpp_cost_diff_line_break_fkey
      FOREIGN KEY (bank_id, reconciliation_break_id)
      REFERENCES reconciliation_break(bank_id, id);
  END IF;
END $$;
