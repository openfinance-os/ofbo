-- BILL-03: expected Collection Memo, received scheme memo diff, and closed-period replay.
-- Every relation is an immutable fact. A corrected rate card writes a new rerating
-- artifact; it never updates the meter run, the original expectation, or received memo.

CREATE UNIQUE INDEX IF NOT EXISTS billing_meter_run_tenant_id_uidx
  ON billing_meter_run (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_expected_memo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  meter_run_id          uuid NOT NULL,
  meter_input_hash      text NOT NULL,
  period                text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rate_card_version     text NOT NULL,
  generated_at          timestamptz NOT NULL,
  due_at                timestamptz NOT NULL,
  generated_on_time     boolean NOT NULL,
  total_milli_fils      bigint NOT NULL CHECK (total_milli_fils >= 0),
  statement_payload     jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, meter_run_id) REFERENCES billing_meter_run(bank_id, id),
  UNIQUE (bank_id, meter_run_id, rate_card_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_expected_memo_tenant_id_uidx
  ON billing_expected_memo (bank_id, id);

CREATE INDEX IF NOT EXISTS billing_expected_memo_period_idx
  ON billing_expected_memo (bank_id, period, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_expected_memo_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  expected_memo_id      uuid NOT NULL,
  line_ref              text NOT NULL,
  tpp_id                text NOT NULL,
  fee_class             text NOT NULL,
  units                 integer NOT NULL CHECK (units >= 0),
  event_count           integer NOT NULL CHECK (event_count >= 0),
  amount_milli_fils     bigint NOT NULL CHECK (amount_milli_fils >= 0),
  value_milli_fils      bigint NOT NULL CHECK (value_milli_fils >= 0),
  event_ids             text[] NOT NULL,
  fapi_interaction_ids  text[] NOT NULL,
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, expected_memo_id) REFERENCES billing_expected_memo(bank_id, id),
  UNIQUE (bank_id, expected_memo_id, line_ref)
);

CREATE INDEX IF NOT EXISTS billing_expected_memo_line_tpp_idx
  ON billing_expected_memo_line (bank_id, tpp_id, fee_class);

CREATE TABLE IF NOT EXISTS billing_collection_memo_reconciliation (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                  uuid NOT NULL,
  channel                  ofbo_channel NOT NULL,
  expected_memo_id         uuid NOT NULL,
  memo_reference           text NOT NULL,
  period                   text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  memo_content_hash        text NOT NULL,
  issued_at                timestamptz NOT NULL,
  received_at              timestamptz NOT NULL,
  threshold_milli_fils     bigint NOT NULL CHECK (threshold_milli_fils >= 0),
  query_deadline           timestamptz NOT NULL,
  query_window_status      text NOT NULL CHECK (query_window_status IN ('open','expired')),
  reconciliation_run_id    text NOT NULL,
  material_break_count     integer NOT NULL CHECK (material_break_count >= 0),
  expected_total_milli_fils bigint NOT NULL CHECK (expected_total_milli_fils >= 0),
  memo_total_milli_fils    bigint NOT NULL CHECK (memo_total_milli_fils >= 0),
  net_variance_milli_fils  bigint NOT NULL,
  gross_variance_milli_fils bigint NOT NULL CHECK (gross_variance_milli_fils >= 0),
  memo_payload             jsonb NOT NULL,
  diff_payload             jsonb NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  classification           ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, expected_memo_id) REFERENCES billing_expected_memo(bank_id, id),
  UNIQUE (bank_id, memo_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_collection_memo_tenant_id_uidx
  ON billing_collection_memo_reconciliation (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_memo_diff_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  memo_reconciliation_id uuid NOT NULL,
  line_ref              text NOT NULL,
  tpp_id                text NOT NULL,
  fee_class             text NOT NULL,
  expected_milli_fils   bigint NOT NULL CHECK (expected_milli_fils >= 0),
  memo_milli_fils       bigint NOT NULL CHECK (memo_milli_fils >= 0),
  variance_milli_fils   bigint NOT NULL,
  material_variance     boolean NOT NULL,
  presence              text NOT NULL CHECK (presence IN ('both','expected_only','memo_only')),
  event_ids             text[] NOT NULL,
  fapi_interaction_ids  text[] NOT NULL,
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, memo_reconciliation_id)
    REFERENCES billing_collection_memo_reconciliation(bank_id, id),
  UNIQUE (bank_id, memo_reconciliation_id, line_ref)
);

CREATE INDEX IF NOT EXISTS billing_memo_diff_line_break_idx
  ON billing_memo_diff_line (bank_id, material_variance, tpp_id, fee_class);

CREATE TABLE IF NOT EXISTS billing_period_rerating (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                  uuid NOT NULL,
  channel                  ofbo_channel NOT NULL,
  meter_run_id             uuid NOT NULL,
  period                   text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  correction_reference     text NOT NULL,
  previous_rate_card_version text NOT NULL,
  corrected_rate_card_version text NOT NULL,
  metered_facts_fingerprint text NOT NULL,
  facts_unchanged          boolean NOT NULL CHECK (facts_unchanged),
  previous_total_milli_fils bigint NOT NULL CHECK (previous_total_milli_fils >= 0),
  corrected_total_milli_fils bigint NOT NULL CHECK (corrected_total_milli_fils >= 0),
  total_delta_milli_fils   bigint NOT NULL,
  rerated_at               timestamptz NOT NULL,
  replay_payload           jsonb NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  classification           ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, meter_run_id) REFERENCES billing_meter_run(bank_id, id),
  UNIQUE (bank_id, meter_run_id, corrected_rate_card_version, correction_reference)
);

-- All BILL-03 relations are INSERT-only for the application role.
DO $$
DECLARE
  immutable_table text;
BEGIN
  FOREACH immutable_table IN ARRAY ARRAY[
    'billing_expected_memo',
    'billing_expected_memo_line',
    'billing_collection_memo_reconciliation',
    'billing_memo_diff_line',
    'billing_period_rerating'
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
    EXECUTE format($p$ DO $i$ BEGIN
      CREATE POLICY internal_view_select ON %I FOR SELECT TO bank_internal_view USING (
        NULLIF(current_setting('app.tenant_group', true), '') IS NULL
        OR bank_id IN (
          SELECT m.bank_id FROM tenant_group_member m
          WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
        )
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $i$; $p$, immutable_table);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ofbo_app', immutable_table);
    EXECUTE format('GRANT SELECT ON %I TO bank_internal_view', immutable_table);
  END LOOP;
END $$;

INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('billing_expected_memo', 24, 60),
  ('billing_expected_memo_line', 24, 60),
  ('billing_collection_memo_reconciliation', 24, 60),
  ('billing_memo_diff_line', 24, 60),
  ('billing_period_rerating', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_expected_memo', 'confidential-restricted'),
  ('billing_expected_memo_line', 'confidential-restricted'),
  ('billing_collection_memo_reconciliation', 'confidential-restricted'),
  ('billing_memo_diff_line', 'confidential-restricted'),
  ('billing_period_rerating', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
