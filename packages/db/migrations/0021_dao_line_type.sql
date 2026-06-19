-- BACKOFFICE-68: Dynamic Account Opening reconciliation coverage. DAO API calls join
-- the three-way match as a new line class (dao_api_call, added to the contract LineType
-- enum in the merged spec PR). Extend the reconciliation_break line_type CHECK to admit
-- it. Additive value only — existing rows + RLS/retention/classification are unaffected.

ALTER TABLE reconciliation_break DROP CONSTRAINT IF EXISTS reconciliation_break_line_type_check;
ALTER TABLE reconciliation_break ADD CONSTRAINT reconciliation_break_line_type_check
  CHECK (line_type IN ('nebras_fees','payment_settlement','consent_record','tpp_aas_pass_through','lfi_access_log','dao_api_call'));
