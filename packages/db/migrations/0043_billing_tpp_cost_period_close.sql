-- BILL-16 — the cost-period close, and the cross-tenant read BILL-13 withheld on AP dispatch.
--
-- Two things, one migration, because they are the same obligation discharged at both ends of the
-- payable lifecycle: the close is what authorises a payable, and the dispatch is what acts on that
-- authority. Migration 0039 created the dispatch table and deliberately left the close table to the
-- story that could state what a close IS; 0040 granted the internal-view read on the document table
-- once BILL-14 proved parse-time redaction, and named billing_tpp_cost_ap_dispatch as BILL-16's to
-- grant "on the same terms". This migration is those terms being met.
--
-- WHY A TABLE AND NOT A COLUMN. A close is evidence of a four-eyes act — two named principals, an
-- approval, a moment — not a status flag on a period that has no row of its own. Modelling it as a
-- boolean somewhere would leave the evidence denormalised onto whatever row happened to carry it,
-- and this family has no UPDATE grant to set such a flag anyway.
--
-- INSERT-only, like every other table in the family: FORCE RLS, SELECT+INSERT for ofbo_app, no
-- UPDATE and no DELETE, 24-month hot / 5-year immutable retention, confidential-restricted floor.

-- ---------------------------------------------------------------------------------------------
-- billing_tpp_cost_period_close
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_period_close (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  billing_period         text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- Both principals, stored NORMALISED (lower(btrim(...))) by the write path.
  --
  -- The CHECK below can only prove that two recorded STRINGS differ. It cannot detect one human
  -- appearing under two identifier forms — an IdP subject in one column and an e-mail in the other
  -- would satisfy it. Closing that is the write path's obligation, discharged by taking BOTH names
  -- from the cited approval RECORD (never from the operator's payload) and normalising each through
  -- the one sanctioned comparator. The same weakness, and the same remedy, as the AP-dispatch
  -- principal columns 0039 documents.
  initiated_by           text NOT NULL,
  approved_by            text NOT NULL,
  -- The approval that closed the period. Tenant-composite, so one bank cannot cite another's
  -- approval — the same idiom as billing_tpp_cost_ap_dispatch, using the composite key 0039 added.
  --
  -- NOT NULL here, unlike the nullable field on the service interface: a close row exists only
  -- because an approval executed it. A close citing no approval would be a period shut by one
  -- person, which is the exact thing the four-eyes rule exists to prevent, so it must be
  -- unrepresentable rather than merely unusual.
  approval_request_id    text NOT NULL,
  -- Always true today. Recorded as DATA rather than left to convention so the relationship to the
  -- BACKOFFICE-06 monthly sign-off is readable from the row itself: this close is a precondition
  -- the sign-off consumes, never a sign-off of its own.
  feeds_monthly_signoff  boolean NOT NULL DEFAULT true,
  closed_at              timestamptz NOT NULL DEFAULT now(),
  -- Canonical SHA-256 over the close's own substance, matching the family's evidence-hash idiom.
  evidence_hash          text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  classification         ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, approval_request_id)
    REFERENCES approval_request(bank_id, approval_request_id),
  -- Four eyes, not one. Normalised so case and padding variants of a single identifier do not slip
  -- past a raw <>, mirroring billing_tpp_cost_ap_dispatch (0039) and approval_request itself.
  CHECK (lower(btrim(approved_by)) <> lower(btrim(initiated_by))),
  -- ONE close per period per tenant. This is what makes the write idempotent on an INSERT-only
  -- table: a retried execution hits ON CONFLICT DO NOTHING and returns the existing row rather than
  -- minting a second four-eyes record for one act. It also makes re-closing a closed period a
  -- refusal the schema can express, instead of a check the service has to remember.
  UNIQUE (bank_id, billing_period)
);

-- Composite identity, so a later row can reference a close within its tenant. Cheap now, and the
-- family has shown that adding one after rows exist is the awkward case (billing_meter_run needed a
-- follow-up migration for exactly this).
CREATE UNIQUE INDEX IF NOT EXISTS billing_tpp_cost_period_close_bank_id_key
  ON billing_tpp_cost_period_close (bank_id, id);

CREATE INDEX IF NOT EXISTS billing_tpp_cost_period_close_period_idx
  ON billing_tpp_cost_period_close (bank_id, billing_period);

-- ---------------------------------------------------------------------------------------------
-- Controls: the same posture 0039 applies to the other eight.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE billing_tpp_cost_period_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_tpp_cost_period_close FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenancy_select ON billing_tpp_cost_period_close FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tenancy_insert ON billing_tpp_cost_period_close FOR INSERT TO ofbo_app
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON billing_tpp_cost_period_close TO ofbo_app;

-- Cross-tenant internal-view read is granted here, unlike the two provider-fed tables 0039 withheld.
-- Every column above is schema-constrained and PSU-free by construction: a period string, two
-- principal identifiers, an approval id, a boolean, two timestamps and a digest. There is no
-- free-form provider column for customer detail to arrive in, which is the whole basis on which
-- 0039 drew that line.
DO $$ BEGIN
  CREATE POLICY internal_view_select ON billing_tpp_cost_period_close FOR SELECT TO bank_internal_view
    USING (
      NULLIF(current_setting('app.tenant_group', true), '') IS NULL
      OR bank_id IN (
        SELECT m.bank_id FROM tenant_group_member m
        WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON billing_tpp_cost_period_close TO bank_internal_view;

INSERT INTO retention_policy (table_name, hot_months, immutable_months)
VALUES ('billing_tpp_cost_period_close', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor)
VALUES ('billing_tpp_cost_period_close', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- billing_tpp_cost_ap_dispatch: the cross-tenant read 0039 withheld and 0040 deferred to BILL-16.
-- ---------------------------------------------------------------------------------------------
--
-- The condition 0040 set was redaction of `response_payload` BEFORE the first INSERT, proven by a
-- test against a persisted row — the same bar BILL-14 cleared for `parsed_payload`. That control now
-- exists: PgPayableDispatchStore redacts the P9 response through the shared provider-payload
-- redactor and RE-CHECKS at the write boundary, refusing the INSERT outright if any field still
-- matches a customer-detail shape. The dispatch_ref is redacted a second time in the service before
-- it ever reaches the store, and the caller-supplied Idempotency-Key is stored as a digest rather
-- than in the clear, because an inbound header's content is whatever an operator typed into it.
--
-- With no unredacted provider text reachable in this table, the reason for withholding is gone, and
-- the family's remaining asymmetry with it would be arbitrary rather than principled.
DO $$ BEGIN
  CREATE POLICY internal_view_select ON billing_tpp_cost_ap_dispatch FOR SELECT TO bank_internal_view
    USING (
      NULLIF(current_setting('app.tenant_group', true), '') IS NULL
      OR bank_id IN (
        SELECT m.bank_id FROM tenant_group_member m
        WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON billing_tpp_cost_ap_dispatch TO bank_internal_view;
