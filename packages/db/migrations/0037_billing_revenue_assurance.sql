-- BILL-08: immutable monthly revenue-assurance reports, findings and recovered-revenue log.

CREATE TABLE IF NOT EXISTS billing_revenue_recovery (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  recovery_id                text NOT NULL,
  billing_period             text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  finding_code               text NOT NULL CHECK (finding_code IN ('memo_under_collection','rate_drift','free_tier_abuse','unbilled_traffic','metering_blind_spot')),
  amount_milli_fils          bigint NOT NULL CHECK (amount_milli_fils > 0),
  recovered_at               timestamptz NOT NULL,
  source_ref                 text NOT NULL,
  content_sha256             text NOT NULL CHECK (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, recovery_id)
);

CREATE TABLE IF NOT EXISTS billing_revenue_assurance_report (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  billing_period             text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  generated_at               timestamptz NOT NULL,
  metering_coverage_bps      integer NOT NULL CHECK (metering_coverage_bps BETWEEN 0 AND 10000),
  gross_receivable_milli_fils bigint NOT NULL CHECK (gross_receivable_milli_fils >= 0),
  leakage_milli_fils         bigint NOT NULL CHECK (leakage_milli_fils >= 0),
  leakage_ppm                integer NOT NULL CHECK (leakage_ppm >= 0),
  counterfactual_milli_fils  bigint NOT NULL CHECK (counterfactual_milli_fils >= 0),
  recoverable_milli_fils     bigint NOT NULL CHECK (recoverable_milli_fils >= 0),
  recovered_milli_fils       bigint NOT NULL CHECK (recovered_milli_fils >= 0),
  outstanding_milli_fils     bigint NOT NULL CHECK (outstanding_milli_fils >= 0),
  dispute_raised_count       integer NOT NULL CHECK (dispute_raised_count >= 0),
  dispute_missed_count       integer NOT NULL CHECK (dispute_missed_count >= 0),
  target_met                 boolean NOT NULL,
  input_sha256               text NOT NULL CHECK (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  report_payload             jsonb NOT NULL,
  fapi_interaction_id        text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  CHECK (recovered_milli_fils <= recoverable_milli_fils),
  CHECK (outstanding_milli_fils = recoverable_milli_fils - recovered_milli_fils),
  UNIQUE (bank_id, billing_period, input_sha256),
  UNIQUE (bank_id, id)
);

CREATE TABLE IF NOT EXISTS billing_revenue_assurance_finding (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  report_id                  uuid NOT NULL,
  finding_code               text NOT NULL CHECK (finding_code IN ('memo_under_collection','rate_drift','free_tier_abuse','unbilled_traffic','metering_blind_spot','silent_overage','unsuccessful_calls')),
  title                      text NOT NULL,
  amount_milli_fils          bigint NOT NULL CHECK (amount_milli_fils >= 0),
  counterfactual_milli_fils  bigint NOT NULL CHECK (counterfactual_milli_fils >= 0),
  recoverable                boolean NOT NULL,
  finding_status             text NOT NULL CHECK (finding_status IN ('open','query_required','blocked','opportunity','informational')),
  owner                      text NOT NULL CHECK (owner IN ('Finance','Finance Ops','Platform','Commercial')),
  source_refs                text[] NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, report_id) REFERENCES billing_revenue_assurance_report(bank_id, id),
  UNIQUE (bank_id, report_id, finding_code)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_revenue_recovery','billing_revenue_assurance_report','billing_revenue_assurance_finding'] LOOP
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
  ('billing_revenue_recovery', 24, 60),
  ('billing_revenue_assurance_report', 24, 60),
  ('billing_revenue_assurance_finding', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_revenue_recovery', 'confidential-restricted'),
  ('billing_revenue_assurance_report', 'confidential-restricted'),
  ('billing_revenue_assurance_finding', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
