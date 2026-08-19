-- BILL-14: grant the cross-tenant internal-view read on billing_tpp_cost_document.
--
-- BILL-13 created that table but DELIBERATELY withheld this grant (0039, the loop that excludes
-- billing_tpp_cost_document and billing_tpp_cost_ap_dispatch), because two of its columns —
-- raw_document_ref and parsed_payload — carry provider-supplied free-form content that the schema
-- cannot constrain, in a family with no deletion path. Handing a cross-tenant aggregate reader a view
-- of unredacted provider payloads would have been the wrong default.
--
-- BILL-14 now redacts at parse time, before the first INSERT — by field name and by identifier SHAPE,
-- so a real value the redactor has never seen is still caught — and the store refuses a payload that
-- still matches any of those shapes. That control is asserted by test against a persisted row, which
-- is the precondition this grant was waiting on (BILL-14 acceptance criterion 5).
--
-- billing_tpp_cost_ap_dispatch stays excluded: its response_payload is P9's, written by BILL-16, and
-- carries no redaction control yet. It is BILL-16's to grant, on the same terms.
--
-- The policy is the ratified HOST-02 / ADR 0028 idiom, verbatim, including its unpinned-group
-- fallback. That fallback is fail-open and is being fixed repo-wide under HOST-04 — deviating here
-- would leave ten policies disagreeing about what an unpinned session means, which is worse than one
-- consistent known weakness with an owner.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'billing_tpp_cost_document' AND policyname = 'internal_view_select'
  ) THEN
    CREATE POLICY internal_view_select ON billing_tpp_cost_document
      FOR SELECT TO bank_internal_view USING (
        NULLIF(current_setting('app.tenant_group', true), '') IS NULL
        OR bank_id IN (
          SELECT m.bank_id FROM tenant_group_member m
          WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
        )
      );
  END IF;
END $$;

GRANT SELECT ON billing_tpp_cost_document TO bank_internal_view;
