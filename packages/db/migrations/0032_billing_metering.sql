-- BILL-02: independent billable-event metering.
-- Raw CloudEvents are the immutable, exactly-once source of truth. Meter runs are
-- immutable deterministic projections, so a late arrival creates a new run rather
-- than rewriting either the original evidence or an earlier result.

CREATE TABLE IF NOT EXISTS billing_event (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  event_id              text NOT NULL,
  event_source          text NOT NULL,
  event_type            text NOT NULL CHECK (event_type = 'com.ofbo.billing.gateway-call.v1'),
  occurred_at           timestamptz NOT NULL,
  event_hash            text NOT NULL,
  event_payload         jsonb NOT NULL,
  fapi_interaction_id   text NOT NULL,
  endpoint              text NOT NULL,
  outcome               integer NOT NULL CHECK (outcome >= 0),
  direction             text NOT NULL CHECK (direction IN ('inbound','outbound')),
  tpp_id                text NOT NULL,
  psu_id                text,
  received_at           timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, event_id)
);

CREATE INDEX IF NOT EXISTS billing_event_period_idx
  ON billing_event (bank_id, occurred_at, event_id);

CREATE TABLE IF NOT EXISTS billing_meter_run (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  period                text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rate_card_version     text NOT NULL,
  input_hash            text NOT NULL,
  event_count           integer NOT NULL CHECK (event_count >= 0),
  stats                 jsonb NOT NULL,
  evidence              jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, period, rate_card_version, input_hash)
);

CREATE INDEX IF NOT EXISTS billing_meter_run_period_idx
  ON billing_meter_run (bank_id, period, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_metered_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  meter_run_id          uuid NOT NULL REFERENCES billing_meter_run(id),
  event_id              text NOT NULL,
  occurred_at           timestamptz NOT NULL,
  fapi_interaction_id   text NOT NULL,
  side                  text NOT NULL CHECK (side IN ('receivable','payable_hub','payable_lfi','free_to_lfi')),
  fee_class             text NOT NULL,
  units                 integer NOT NULL CHECK (units >= 0),
  free_units            integer CHECK (free_units >= 0),
  line_payload          jsonb NOT NULL,
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, event_id) REFERENCES billing_event(bank_id, event_id),
  UNIQUE (bank_id, meter_run_id, event_id, side)
);

CREATE INDEX IF NOT EXISTS billing_metered_line_trace_idx
  ON billing_metered_line (bank_id, fapi_interaction_id);

-- All three relations are immutable application facts: SELECT + INSERT only.
DO $$
DECLARE
  immutable_table text;
BEGIN
  FOREACH immutable_table IN ARRAY ARRAY['billing_event', 'billing_meter_run', 'billing_metered_line']
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
  ('billing_event', 24, 60),
  ('billing_meter_run', 24, 60),
  ('billing_metered_line', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_event', 'confidential-restricted'),
  ('billing_meter_run', 'confidential-restricted'),
  ('billing_metered_line', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
