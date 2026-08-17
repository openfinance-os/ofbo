-- BILL-13: the durable TPP Cost Management payable ledger (ADR 0007).
--
-- The payable twin of the BILL-03 receivable ledger, and TPP-domain data under ADR 0006 — kept in
-- its own table family rather than shared with the LFI-receivable tables, which is what makes the
-- dual-role wall enforceable rather than nominal.
--
-- ROLE DOMAIN: every table below is TPP-domain (ADR 0006). What is tagged here is sensitivity
-- (ofbo_classification); the role_domain DIMENSION itself — the scope-layer guard, the RLS
-- predicate, and the cross_domain_access audit seam — is SEG-01, which ADR 0006 blocks on BD-22.
-- Recorded here so the domain of this family is unambiguous the day SEG-01 threads it through,
-- rather than inferred later from table names.
--
-- Every relation is an immutable application fact: SELECT + INSERT only for ofbo_app, tenant RLS
-- FORCED, 24-month hot / 60-month immutable retention, no deletion path. A corrected rate or a
-- late-arriving document writes a NEW artifact — billing_tpp_cost_rerating for a closed period —
-- and never updates a statement, a document, or a reconciliation already written.
--
-- PSU DATA. No column below is a PSU identifier, and the statement family carries none by
-- construction — asserted by test. Drill-down to a customer runs through event_ids into
-- billing_event, which is where psu_id is already governed; copying it here would widen the PII
-- surface for no analytical gain (CLAUDE.md hard stop).
--
-- The claim is narrower than "no PSU data can ever land here", and deliberately so: three columns
-- carry provider-supplied free-form content that this schema cannot constrain —
-- billing_tpp_cost_document.parsed_payload, .raw_document_ref, and
-- billing_tpp_cost_ap_dispatch.response_payload. A Nebras invoice line or a P9 response may well
-- contain payment-level customer detail. Redacting at parse/ingest time is therefore a REQUIREMENT
-- ON BILL-14 and BILL-16, which own those write paths, and must be asserted by their tests; it
-- cannot be delegated to a CHECK constraint.
--
-- Three tables are written by BILL-13 (statement, statement_line, rerating). The remaining five are
-- created here so the ledger's shape is settled in one reviewed migration, and are written by the
-- stories that own them: documents by BILL-14, reconciliation and diff lines by BILL-15, AP dispatch
-- by BILL-16. They stay EMPTY until then, which the Q4.5 lineage gate skips (it only requires
-- lineage for tables that actually hold rows) — so nothing may seed them ahead of their story.

-- ---------------------------------------------------------------------------------------------
-- Prerequisite for the tenant-composite four-eyes foreign key on billing_tpp_cost_ap_dispatch.
--
-- approval_request.approval_request_id is globally UNIQUE (0002_tables.sql), which is enough to
-- reference but NOT enough to reference within a tenant: a single-column FK would let one bank cite
-- another bank's approval. This adds the composite key the FK below needs. Purely additive — it
-- constrains nothing that the existing global UNIQUE did not already constrain.
-- ---------------------------------------------------------------------------------------------

-- Guarded because Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this file is defensive about
-- re-execution throughout (CREATE TABLE IF NOT EXISTS) even though the runner applies each migration
-- exactly once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_bank_scoped_key'
  ) THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_bank_scoped_key UNIQUE (bank_id, approval_request_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Expected cost: what the institution should expect to pay, projected from its own metering.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_statement (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                               uuid NOT NULL,
  channel                               ofbo_channel NOT NULL,
  meter_run_id                          uuid NOT NULL,
  period                                text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  currency                              text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  rate_card_version                     text NOT NULL,
  -- Chains the pricing-document version and the directory snapshot the amounts were priced from.
  rate_snapshot_hash                    text NOT NULL,
  -- Null when the period carried no directory-priced overage; see ADR 0007 open items.
  directory_snapshot_id                 text,
  pricing_effective_from                date NOT NULL,
  generated_at                          timestamptz NOT NULL,
  rating_run_at                         timestamptz NOT NULL,
  nebras_hub_net_milli_fils             bigint NOT NULL CHECK (nebras_hub_net_milli_fils >= 0),
  underlying_lfi_payment_net_milli_fils bigint NOT NULL CHECK (underlying_lfi_payment_net_milli_fils >= 0),
  underlying_lfi_data_net_milli_fils    bigint NOT NULL CHECK (underlying_lfi_data_net_milli_fils >= 0),
  total_net_milli_fils                  bigint NOT NULL CHECK (total_net_milli_fils >= 0),
  total_vat_milli_fils                  bigint NOT NULL CHECK (total_vat_milli_fils >= 0),
  total_gross_milli_fils                bigint NOT NULL CHECK (total_gross_milli_fils >= 0),
  statement_payload                     jsonb NOT NULL,
  evidence_hash                         text NOT NULL,
  created_at                            timestamptz NOT NULL DEFAULT now(),
  classification                        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, meter_run_id) REFERENCES billing_meter_run(bank_id, id),
  -- The three streams must add up to the net total: a statement that does not reconcile to itself
  -- is not storable.
  CHECK (total_net_milli_fils = nebras_hub_net_milli_fils
    + underlying_lfi_payment_net_milli_fils
    + underlying_lfi_data_net_milli_fils),
  CHECK (total_gross_milli_fils = total_net_milli_fils + total_vat_milli_fils),
  -- One statement per (meter run, rate card, rate snapshot). A corrected snapshot is a new row.
  UNIQUE (bank_id, meter_run_id, rate_card_version, rate_snapshot_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_tpp_cost_statement_tenant_id_uidx
  ON billing_tpp_cost_statement (bank_id, id);

CREATE INDEX IF NOT EXISTS billing_tpp_cost_statement_period_idx
  ON billing_tpp_cost_statement (bank_id, period, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_tpp_cost_statement_line (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                   uuid NOT NULL,
  channel                   ofbo_channel NOT NULL,
  statement_id              uuid NOT NULL,
  line_ref                  text NOT NULL,
  cost_recipient_type       text NOT NULL CHECK (cost_recipient_type IN ('nebras','underlying_lfi')),
  cost_recipient_id         text NOT NULL,
  fee_stream                text NOT NULL CHECK (fee_stream IN ('hub','lfi_payment','lfi_data')),
  fee_class                 text NOT NULL,
  product_family            text NOT NULL,
  api_family                text NOT NULL,
  customer_segment          text NOT NULL CHECK (customer_segment IN ('retail','corporate','unclassified')),
  internal_product          text,
  cost_centre_ref           text,
  units                     integer NOT NULL CHECK (units >= 0),
  event_count               integer NOT NULL CHECK (event_count >= 0),
  -- Hub fees are billed VAT-exclusive, TPP-to-LFI fees VAT-inclusive (ADR 0007 D4).
  vat_treatment             text NOT NULL CHECK (vat_treatment IN ('exclusive','inclusive')),
  expected_net_milli_fils   bigint NOT NULL CHECK (expected_net_milli_fils >= 0),
  vat_milli_fils            bigint NOT NULL CHECK (vat_milli_fils >= 0),
  expected_gross_milli_fils bigint NOT NULL CHECK (expected_gross_milli_fils >= 0),
  event_ids                 text[] NOT NULL,
  fapi_interaction_ids      text[] NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  classification            ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, statement_id) REFERENCES billing_tpp_cost_statement(bank_id, id),
  CHECK (expected_gross_milli_fils = expected_net_milli_fils + vat_milli_fils),
  -- Every line must be traceable to the traffic that caused it.
  CHECK (cardinality(event_ids) > 0),
  UNIQUE (bank_id, statement_id, line_ref)
);

CREATE INDEX IF NOT EXISTS billing_tpp_cost_statement_line_recipient_idx
  ON billing_tpp_cost_statement_line (bank_id, cost_recipient_type, cost_recipient_id, fee_class);

-- ---------------------------------------------------------------------------------------------
-- Actuals: provider documents. Written by BILL-14 — Nebras invoice/settlement statement primary.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_document (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  document_type         text NOT NULL CHECK (document_type IN (
                          'nebras_tax_invoice','nebras_settlement_statement','lfi_self_invoice',
                          'credit_note','debit_note','manual_adjustment')),
  issuer_id             text NOT NULL,
  recipient_id          text NOT NULL,
  document_reference    text NOT NULL,
  billing_period        text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  currency              text NOT NULL CHECK (currency = 'AED'),
  gross_milli_fils      bigint NOT NULL,
  vat_milli_fils        bigint NOT NULL,
  net_milli_fils        bigint NOT NULL,
  -- Integrity of the raw artifact, and the pointer to the retained original.
  document_sha256       text NOT NULL,
  raw_document_ref      text NOT NULL,
  issued_at             timestamptz NOT NULL,
  received_at           timestamptz NOT NULL,
  -- Verified manual upload: second-person verification is recorded, never inferred.
  verified_by           text NOT NULL,
  verified_at           timestamptz NOT NULL,
  idempotency_key       text NOT NULL,
  parsed_payload        jsonb NOT NULL,
  evidence_hash         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  CHECK (gross_milli_fils = net_milli_fils + vat_milli_fils),
  -- Same issuer + reference is the same document: a differing body is a conflict, not a second row.
  UNIQUE (bank_id, issuer_id, document_reference),
  UNIQUE (bank_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_tpp_cost_document_tenant_id_uidx
  ON billing_tpp_cost_document (bank_id, id);

CREATE INDEX IF NOT EXISTS billing_tpp_cost_document_period_idx
  ON billing_tpp_cost_document (bank_id, billing_period, document_type, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_tpp_cost_document_line (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                 uuid NOT NULL,
  channel                 ofbo_channel NOT NULL,
  document_id             uuid NOT NULL,
  line_ref                text NOT NULL,
  -- The provider's own line category (IG v5.0 §10.9/§10.10), kept verbatim as evidence.
  source_category         text NOT NULL,
  -- Null when the category maps to no known fee class: flagged unmapped, never silently dropped.
  fee_class               text,
  mapped                  boolean NOT NULL,
  cost_recipient_type     text NOT NULL CHECK (cost_recipient_type IN ('nebras','underlying_lfi')),
  cost_recipient_id       text NOT NULL,
  units                   integer NOT NULL CHECK (units >= 0),
  unit_price_milli_fils   bigint NOT NULL CHECK (unit_price_milli_fils >= 0),
  actual_net_milli_fils   bigint NOT NULL,
  vat_milli_fils          bigint NOT NULL,
  actual_gross_milli_fils bigint NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  classification          ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, document_id) REFERENCES billing_tpp_cost_document(bank_id, id),
  CHECK (actual_gross_milli_fils = actual_net_milli_fils + vat_milli_fils),
  CHECK ((fee_class IS NULL) = (mapped IS FALSE)),
  UNIQUE (bank_id, document_id, line_ref)
);

-- ---------------------------------------------------------------------------------------------
-- Three-way reconciliation and its breaks. Written by BILL-15.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_reconciliation (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                        uuid NOT NULL,
  channel                        ofbo_channel NOT NULL,
  statement_id                   uuid NOT NULL,
  document_id                    uuid NOT NULL,
  billing_period                 text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- Expected values are milli-fils, documents arrive in fils: matching is never exact equality.
  tolerance_milli_fils           bigint NOT NULL CHECK (tolerance_milli_fils >= 0),
  -- Scheme-published billing-query window (IG v5.0 §10.13), configurable per BD-21.
  query_deadline                 timestamptz NOT NULL,
  query_window_status            text NOT NULL CHECK (query_window_status IN ('open','expired')),
  reconciliation_run_id          text NOT NULL,
  matched_line_count             integer NOT NULL CHECK (matched_line_count >= 0),
  break_count                    integer NOT NULL CHECK (break_count >= 0),
  expected_total_net_milli_fils  bigint NOT NULL,
  actual_total_net_milli_fils    bigint NOT NULL,
  net_variance_milli_fils        bigint NOT NULL,
  gross_variance_milli_fils      bigint NOT NULL CHECK (gross_variance_milli_fils >= 0),
  evidence_hash                  text NOT NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  classification                 ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, statement_id) REFERENCES billing_tpp_cost_statement(bank_id, id),
  FOREIGN KEY (bank_id, document_id) REFERENCES billing_tpp_cost_document(bank_id, id),
  UNIQUE (bank_id, statement_id, document_id, reconciliation_run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_tpp_cost_reconciliation_tenant_id_uidx
  ON billing_tpp_cost_reconciliation (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_tpp_cost_diff_line (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                  uuid NOT NULL,
  channel                  ofbo_channel NOT NULL,
  reconciliation_id        uuid NOT NULL,
  line_ref                 text NOT NULL,
  break_type               text NOT NULL CHECK (break_type IN (
                             'quantity_variance','rate_variance','unexpected_charge','missing_charge',
                             'wrong_recipient','duplicate_charge','vat_variance','period_variance',
                             'unmatched_document_line','unmatched_expected_line')),
  cost_recipient_type      text NOT NULL CHECK (cost_recipient_type IN ('nebras','underlying_lfi')),
  cost_recipient_id        text NOT NULL,
  fee_class                text,
  expected_milli_fils      bigint NOT NULL,
  actual_milli_fils        bigint NOT NULL,
  variance_milli_fils      bigint NOT NULL,
  variance_basis_points    integer NOT NULL,
  material                 boolean NOT NULL,
  presence                 text NOT NULL CHECK (presence IN ('both','expected_only','document_only')),
  reason_code              text,
  -- The E1 break this difference was raised as; the payable side reuses that workflow.
  reconciliation_break_id  uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  classification           ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, reconciliation_id) REFERENCES billing_tpp_cost_reconciliation(bank_id, id),
  UNIQUE (bank_id, reconciliation_id, line_ref)
);

-- ---------------------------------------------------------------------------------------------
-- Accounts-payable dispatch to P9. Written by BILL-16, four-eyes gated before it may exist.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_ap_dispatch (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  statement_id           uuid NOT NULL,
  reconciliation_id      uuid NOT NULL,
  -- The four-eyes approval that authorised this dispatch, referencing approval_request's own
  -- approval_request_id (0002_tables.sql). The FK is TENANT-COMPOSITE (see the constraint below), so
  -- one bank cannot cite another bank's approval — the same (bank_id, id) idiom as this table's other
  -- two foreign keys.
  --
  -- What a foreign key still cannot enforce, because both are mutable state on the referenced row,
  -- and what BILL-16 MUST therefore check at write time: that the request is in state 'approved',
  -- and that its expires_at had not passed when it was approved (2-hour adopting-bank default,
  -- PRD section 10).
  approval_request_id    text NOT NULL,
  -- Initiator recorded alongside approver so the CHECK below can refuse the self-approval it CAN
  -- see, mirroring approval_request's own constraint.
  --
  -- What that CHECK actually guarantees, stated precisely because the guarantee is narrower than
  -- "self-approval is impossible": the two recorded principal strings differ, compared
  -- case-insensitively and ignoring surrounding whitespace. It cannot detect one human appearing
  -- under two DIFFERENT identifier forms — an IdP subject id in one column and a username or e-mail
  -- in the other would satisfy it. Closing that is a write-time obligation on BILL-16: both columns
  -- MUST be stamped from the same normalised P2 subject claim, never from operator-supplied input.
  initiated_by           text NOT NULL,
  approved_by            text NOT NULL,
  approved_at            timestamptz NOT NULL,
  -- Each transition is a NEW row, not an update: this family is INSERT-only, so a dispatch is an
  -- append-only state log whose latest row by created_at is the current state. Modelling it as a
  -- mutable row would have required an UPDATE grant and broken the family's immutability posture.
  dispatch_state         text NOT NULL CHECK (dispatch_state IN (
                           'pending','dispatched','accepted','rejected','failed')),
  financial_system_ref   text,
  idempotency_key        text NOT NULL,
  dispatched_at          timestamptz,
  payable_net_milli_fils bigint NOT NULL CHECK (payable_net_milli_fils >= 0),
  response_payload       jsonb,
  evidence_hash          text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  classification         ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, statement_id) REFERENCES billing_tpp_cost_statement(bank_id, id),
  FOREIGN KEY (bank_id, reconciliation_id) REFERENCES billing_tpp_cost_reconciliation(bank_id, id),
  FOREIGN KEY (bank_id, approval_request_id)
    REFERENCES approval_request(bank_id, approval_request_id),
  -- Four eyes, not one: whoever approved a payable dispatch cannot be whoever initiated it.
  -- Normalised, so trivial variants of one identifier (case, padding) do not slip past a raw <>.
  CHECK (lower(btrim(approved_by)) <> lower(btrim(initiated_by))),
  -- Retry-safe AND progressable: one row per (instruction, state), so re-dispatching the same
  -- instruction in the same state stays a single row — P9 still cannot be double-paid — while the
  -- outcome of that dispatch can be appended as the next state.
  UNIQUE (bank_id, idempotency_key, dispatch_state)
);

-- ---------------------------------------------------------------------------------------------
-- Closed-period corrections: a delta artifact, never a mutation. Written by BILL-13.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_tpp_cost_rerating (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                         uuid NOT NULL,
  channel                         ofbo_channel NOT NULL,
  meter_run_id                    uuid NOT NULL,
  previous_statement_id           uuid NOT NULL,
  corrected_statement_id          uuid NOT NULL,
  period                          text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  correction_reference            text NOT NULL,
  previous_rate_snapshot_hash     text NOT NULL,
  corrected_rate_snapshot_hash    text NOT NULL,
  -- Proof the correction re-priced the SAME immutable facts rather than changing them.
  metered_facts_fingerprint       text NOT NULL,
  facts_unchanged                 boolean NOT NULL CHECK (facts_unchanged),
  previous_total_net_milli_fils   bigint NOT NULL CHECK (previous_total_net_milli_fils >= 0),
  corrected_total_net_milli_fils  bigint NOT NULL CHECK (corrected_total_net_milli_fils >= 0),
  total_delta_net_milli_fils      bigint NOT NULL,
  rerated_at                      timestamptz NOT NULL,
  replay_payload                  jsonb NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  classification                  ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, meter_run_id) REFERENCES billing_meter_run(bank_id, id),
  FOREIGN KEY (bank_id, previous_statement_id) REFERENCES billing_tpp_cost_statement(bank_id, id),
  FOREIGN KEY (bank_id, corrected_statement_id) REFERENCES billing_tpp_cost_statement(bank_id, id),
  CHECK (total_delta_net_milli_fils = corrected_total_net_milli_fils - previous_total_net_milli_fils),
  CHECK (previous_statement_id <> corrected_statement_id),
  UNIQUE (bank_id, previous_statement_id, correction_reference)
);

-- ---------------------------------------------------------------------------------------------
-- Controls, identical in posture to the BILL-02/BILL-03 ledgers: tenant RLS FORCED, no UPDATE and
-- no DELETE grant for the application role, group-scoped internal-view reads only.
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
  immutable_table text;
BEGIN
  FOREACH immutable_table IN ARRAY ARRAY[
    'billing_tpp_cost_statement',
    'billing_tpp_cost_statement_line',
    'billing_tpp_cost_document',
    'billing_tpp_cost_document_line',
    'billing_tpp_cost_reconciliation',
    'billing_tpp_cost_diff_line',
    'billing_tpp_cost_ap_dispatch',
    'billing_tpp_cost_rerating'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', immutable_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', immutable_table);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_select ON %I FOR SELECT TO ofbo_app
        USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, immutable_table);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_insert ON %I FOR INSERT TO ofbo_app
        WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, immutable_table);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ofbo_app', immutable_table);

    -- Cross-tenant internal-view reads are granted to SEVEN of the eight tables, deliberately NOT to
    -- billing_tpp_cost_document (raw_document_ref, parsed_payload) or billing_tpp_cost_ap_dispatch
    -- (response_payload) — the three provider-fed free-form columns this schema cannot constrain, per
    -- the header. Every other relation under this policy is schema-constrained and PSU-free by
    -- construction, which is what makes the governed-aggregate seam an acceptable bypass for them.
    --
    -- Least privilege while the redaction control is still owed by BILL-14/BILL-16: a cross-tenant
    -- benchmark has no need of raw provider payloads, and withholding the grant now costs nothing
    -- because nothing reads these two tables yet. Whichever story adds a genuine cross-tenant need
    -- must grant it deliberately, after redaction exists — not inherit it from a loop.
    IF immutable_table NOT IN ('billing_tpp_cost_document', 'billing_tpp_cost_ap_dispatch') THEN
      EXECUTE format($p$ DO $i$ BEGIN
        CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING (
          NULLIF(current_setting('app.tenant_group', true), '') IS NULL
          OR bank_id IN (
            SELECT m.bank_id FROM tenant_group_member m
            WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
          )
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, immutable_table);
      EXECUTE format('GRANT SELECT ON %I TO bank_internal_view', immutable_table);
    END IF;
  END LOOP;
END $$;

INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('billing_tpp_cost_statement', 24, 60),
  ('billing_tpp_cost_statement_line', 24, 60),
  ('billing_tpp_cost_document', 24, 60),
  ('billing_tpp_cost_document_line', 24, 60),
  ('billing_tpp_cost_reconciliation', 24, 60),
  ('billing_tpp_cost_diff_line', 24, 60),
  ('billing_tpp_cost_ap_dispatch', 24, 60),
  ('billing_tpp_cost_rerating', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_tpp_cost_statement', 'confidential-restricted'),
  ('billing_tpp_cost_statement_line', 'confidential-restricted'),
  ('billing_tpp_cost_document', 'confidential-restricted'),
  ('billing_tpp_cost_document_line', 'confidential-restricted'),
  ('billing_tpp_cost_reconciliation', 'confidential-restricted'),
  ('billing_tpp_cost_diff_line', 'confidential-restricted'),
  ('billing_tpp_cost_ap_dispatch', 'confidential-restricted'),
  ('billing_tpp_cost_rerating', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
