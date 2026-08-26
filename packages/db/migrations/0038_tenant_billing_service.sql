-- HOST-01 + BILL-10: per-tenant adopting-bank and billing configuration, aggregate-only
-- cross-tenant benchmarks, and the control-plane seam used by idempotent provisioning.

CREATE TABLE IF NOT EXISTS tenant_configuration (
  bank_id                         uuid PRIMARY KEY REFERENCES tenant_group_member(bank_id),
  approval_expiry_business_hours integer NOT NULL DEFAULT 2 CHECK (approval_expiry_business_hours BETWEEN 1 AND 24),
  sla_weekend_pause               boolean NOT NULL DEFAULT true,
  fraud_revoke_four_eyes          boolean NOT NULL DEFAULT true,
  care_surface_residency          text NOT NULL DEFAULT 'portal' CHECK (care_surface_residency IN ('portal','enterprise')),
  year_anchor_date                date NOT NULL DEFAULT DATE '2025-10-01',
  retail_overage_milli_fils       bigint CHECK (retail_overage_milli_fils IS NULL OR retail_overage_milli_fils >= 0),
  invoice_template_ref            text NOT NULL DEFAULT 'pint-ae:default:v1',
  invoice_brand_key               text NOT NULL DEFAULT 'institutional-default',
  asp_route_profile               text NOT NULL DEFAULT 'default',
  collection_rail_policy          jsonb NOT NULL DEFAULT '{"preferred":"scheme_net_settlement","fallback":"uaedds"}'::jsonb,
  active                          boolean NOT NULL DEFAULT true,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  classification                 ofbo_classification NOT NULL DEFAULT 'internal-confidential',
  CHECK (length(trim(invoice_template_ref)) > 0),
  CHECK (length(trim(invoice_brand_key)) > 0),
  CHECK (length(trim(asp_route_profile)) > 0)
);

ALTER TABLE tenant_configuration ENABLE ROW LEVEL SECURITY;
-- Deliberately not FORCE: the connection owner is the operator control-plane provisioning
-- identity. ofbo_app has SELECT-only and is still bound by the policy below.
DO $i$ BEGIN
  CREATE POLICY tenancy_select ON tenant_configuration FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
GRANT SELECT ON tenant_configuration TO ofbo_app;

-- Only already-aggregated, non-PII tenant metrics enter this table. It is never exposed
-- tenant-by-tenant to operator analytics; the store enforces purpose approval and k>=3.
CREATE TABLE IF NOT EXISTS billing_benchmark_snapshot (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  period                     text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  receivable_milli_fils      bigint NOT NULL CHECK (receivable_milli_fils >= 0),
  hub_cost_milli_fils        bigint NOT NULL CHECK (hub_cost_milli_fils >= 0),
  liability_milli_fils       bigint NOT NULL CHECK (liability_milli_fils >= 0),
  profit_milli_fils          bigint NOT NULL,
  metering_coverage_percent  numeric(7,4) NOT NULL CHECK (metering_coverage_percent BETWEEN 0 AND 100),
  leakage_percent            numeric(9,6) NOT NULL CHECK (leakage_percent >= 0),
  source_hash                text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  UNIQUE (bank_id, period, source_hash)
);

ALTER TABLE billing_benchmark_snapshot ENABLE ROW LEVEL SECURITY;
-- Deliberately not FORCE: only the owner-side aggregate method may read across tenants;
-- ofbo_app is RLS-pinned and receives no UPDATE/DELETE privilege.
DO $i$ BEGIN
  CREATE POLICY tenancy_select ON billing_benchmark_snapshot FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
DO $i$ BEGIN
  CREATE POLICY tenancy_insert ON billing_benchmark_snapshot FOR INSERT TO ofbo_app
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $i$;
GRANT SELECT, INSERT ON billing_benchmark_snapshot TO ofbo_app;

INSERT INTO retention_policy(table_name, hot_months, immutable_months)
VALUES ('billing_benchmark_snapshot', 24, 60)
ON CONFLICT (table_name) DO UPDATE SET hot_months=EXCLUDED.hot_months, immutable_months=EXCLUDED.immutable_months;

INSERT INTO classification_policy(table_name, floor)
VALUES
  ('tenant_configuration', 'internal-confidential'),
  ('billing_benchmark_snapshot', 'confidential-restricted')
ON CONFLICT (table_name) DO UPDATE SET floor=EXCLUDED.floor;
