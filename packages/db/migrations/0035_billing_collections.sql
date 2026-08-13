-- BILL-05: immutable scheme-settlement decomposition and append-only direct-collection actions.
-- The current dunning state is derived from action history; regulated collection evidence is never updated.

CREATE TABLE IF NOT EXISTS billing_settlement_run (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  settlement_reference       text NOT NULL,
  billing_period             text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  received_milli_fils        bigint NOT NULL,
  expected_net_milli_fils    bigint NOT NULL,
  residue_milli_fils         bigint NOT NULL,
  residue_tolerance_milli_fils bigint NOT NULL CHECK (residue_tolerance_milli_fils >= 0),
  status                     text NOT NULL CHECK (status IN ('matched','break')),
  decomposition_sha256       text NOT NULL CHECK (decomposition_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, settlement_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_settlement_run_tenant_id_uidx
  ON billing_settlement_run (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_settlement_line (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  settlement_run_id          uuid NOT NULL,
  role                       text NOT NULL CHECK (role IN ('lfi_receivable','tpp_of_record_payable')),
  source_id                  text NOT NULL,
  counterparty_id            text NOT NULL,
  signed_milli_fils          bigint NOT NULL,
  ledger_ref                 text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, settlement_run_id) REFERENCES billing_settlement_run(bank_id, id),
  UNIQUE (bank_id, settlement_run_id, role, source_id),
  UNIQUE (bank_id, settlement_run_id, role, ledger_ref),
  CHECK ((role = 'lfi_receivable' AND signed_milli_fils >= 0)
      OR (role = 'tpp_of_record_payable' AND signed_milli_fils <= 0))
);

CREATE TABLE IF NOT EXISTS billing_settlement_break (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  settlement_run_id          uuid NOT NULL,
  break_type                 text NOT NULL CHECK (break_type = 'settlement_residue'),
  amount_milli_fils          bigint NOT NULL,
  receivable_ledger_refs     text[] NOT NULL,
  payable_ledger_refs        text[] NOT NULL,
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, settlement_run_id) REFERENCES billing_settlement_run(bank_id, id),
  UNIQUE (bank_id, settlement_run_id)
);

CREATE TABLE IF NOT EXISTS billing_collection_invoice (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  invoice_id                 text NOT NULL,
  tpp_id                     text NOT NULL,
  issued_at                  date NOT NULL,
  due_at                     date NOT NULL,
  amount_milli_fils          bigint NOT NULL CHECK (amount_milli_fils >= 0),
  settled_at                 date,
  eligible_rails             text[] NOT NULL CHECK (cardinality(eligible_rails) > 0),
  selected_rail              text NOT NULL CHECK (selected_rail IN ('of_invoice_collection','aani_request_to_pay','uaedds')),
  policy_ref                 text NOT NULL,
  invoice_sha256             text NOT NULL CHECK (invoice_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  CHECK (due_at >= issued_at),
  CHECK (settled_at IS NULL OR settled_at >= issued_at),
  CHECK (selected_rail = ANY(eligible_rails)),
  UNIQUE (bank_id, invoice_id),
  UNIQUE (bank_id, id)
);

CREATE TABLE IF NOT EXISTS billing_collection_action (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  collection_invoice_id      uuid NOT NULL,
  invoice_id                 text NOT NULL,
  from_state                 text NOT NULL CHECK (from_state IN ('current','reminded','overdue','escalated','suspension_risk','settled')),
  to_state                   text NOT NULL CHECK (to_state IN ('current','reminded','overdue','escalated','suspension_risk','settled')),
  action_type                text NOT NULL CHECK (action_type IN ('collection_requested','reminder','overdue_notice','escalation','suspension_risk_notice')),
  policy_ref                 text NOT NULL,
  occurred_at                date NOT NULL,
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, collection_invoice_id) REFERENCES billing_collection_invoice(bank_id, id),
  UNIQUE (bank_id, collection_invoice_id, to_state)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_settlement_run','billing_settlement_line','billing_settlement_break',
    'billing_collection_invoice','billing_collection_action'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_select ON %I FOR SELECT TO ofbo_app
        USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY tenancy_insert ON %I FOR INSERT TO ofbo_app
        WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING (
        NULLIF(current_setting('app.tenant_group', true), '') IS NULL OR bank_id IN (
          SELECT m.bank_id FROM tenant_group_member m
          WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
        )
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ofbo_app', t);
    EXECUTE format('GRANT SELECT ON %I TO bank_internal_view', t);
  END LOOP;
END $$;

INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('billing_settlement_run', 24, 60),
  ('billing_settlement_line', 24, 60),
  ('billing_settlement_break', 24, 60),
  ('billing_collection_invoice', 24, 60),
  ('billing_collection_action', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_settlement_run', 'confidential-restricted'),
  ('billing_settlement_line', 'confidential-restricted'),
  ('billing_settlement_break', 'confidential-restricted'),
  ('billing_collection_invoice', 'confidential-restricted'),
  ('billing_collection_action', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
