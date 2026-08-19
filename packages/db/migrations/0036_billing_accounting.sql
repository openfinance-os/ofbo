-- BILL-07: immutable balanced journal instructions and append-only P9 dispatch evidence.
-- OFBO derives/reconciles the accounting; the bank financial system (P9) executes it.

CREATE TABLE IF NOT EXISTS billing_accounting_batch (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  batch_id                   text NOT NULL,
  billing_period             text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  posting_date               date NOT NULL,
  account_profile_ref        text NOT NULL,
  debit_fils                 bigint NOT NULL CHECK (debit_fils >= 0),
  credit_fils                bigint NOT NULL CHECK (credit_fils >= 0),
  balanced                   boolean NOT NULL CHECK (balanced AND debit_fils = credit_fils),
  input_sha256               text NOT NULL CHECK (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  close_pack                 jsonb NOT NULL,
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, batch_id),
  UNIQUE (bank_id, id)
);

CREATE TABLE IF NOT EXISTS billing_journal_instruction (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  accounting_batch_id        uuid NOT NULL,
  journal_id                 text NOT NULL,
  source_type                text NOT NULL CHECK (source_type IN ('pint_ae_invoice','pint_ae_credit_note','hub_payable','net_settlement')),
  source_id                  text NOT NULL,
  debit_fils                 bigint NOT NULL CHECK (debit_fils >= 0),
  credit_fils                bigint NOT NULL CHECK (credit_fils >= 0),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, accounting_batch_id) REFERENCES billing_accounting_batch(bank_id, id),
  UNIQUE (bank_id, accounting_batch_id, journal_id),
  UNIQUE (bank_id, id),
  CHECK (debit_fils = credit_fils)
);

CREATE TABLE IF NOT EXISTS billing_journal_line (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  journal_instruction_id     uuid NOT NULL,
  line_no                    integer NOT NULL CHECK (line_no > 0),
  account                    text NOT NULL,
  entry_side                 text NOT NULL CHECK (entry_side IN ('debit','credit')),
  amount_fils                bigint NOT NULL CHECK (amount_fils > 0),
  fee_class                  text NOT NULL,
  source_refs                text[] NOT NULL CHECK (cardinality(source_refs) > 0),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, journal_instruction_id) REFERENCES billing_journal_instruction(bank_id, id),
  UNIQUE (bank_id, journal_instruction_id, line_no)
);

CREATE TABLE IF NOT EXISTS billing_journal_dispatch (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  accounting_batch_id        uuid NOT NULL,
  attempt_no                 integer NOT NULL CHECK (attempt_no > 0),
  adapter_profile            text NOT NULL CHECK (adapter_profile IN ('demo','enterprise')),
  fapi_interaction_id        text NOT NULL,
  accepted                   boolean NOT NULL,
  journal_batch_ref          text,
  status                     text NOT NULL CHECK (status IN ('accepted','rejected','transport_error')),
  error_detail               text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, accounting_batch_id) REFERENCES billing_accounting_batch(bank_id, id),
  UNIQUE (bank_id, accounting_batch_id, attempt_no),
  CHECK ((status = 'accepted' AND accepted AND journal_batch_ref IS NOT NULL AND error_detail IS NULL)
      OR (status = 'rejected' AND NOT accepted AND error_detail IS NULL)
      OR (status = 'transport_error' AND NOT accepted AND journal_batch_ref IS NULL AND error_detail IS NOT NULL))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_accounting_batch','billing_journal_instruction','billing_journal_line','billing_journal_dispatch'
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
  ('billing_accounting_batch', 24, 60),
  ('billing_journal_instruction', 24, 60),
  ('billing_journal_line', 24, 60),
  ('billing_journal_dispatch', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_accounting_batch', 'confidential-restricted'),
  ('billing_journal_instruction', 'confidential-restricted'),
  ('billing_journal_line', 'confidential-restricted'),
  ('billing_journal_dispatch', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
