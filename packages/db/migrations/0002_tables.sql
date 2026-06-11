-- M0 relational schema (PRD §5). Every table carries bank_id (tenancy) and channel.
-- Money: integer minor units (bigint) + ISO 4217 char(3) — never numeric/float.

DO $$
BEGIN
  CREATE DOMAIN ofbo_channel AS text
    CHECK (VALUE IN ('internal_retail','internal_sme','internal_corporate','external_direct','external_tpp_aas'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS reconciliation_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id             uuid NOT NULL,
  channel             ofbo_channel NOT NULL,
  run_id              text NOT NULL UNIQUE,
  run_type            text NOT NULL CHECK (run_type IN ('daily','monthly_close','replay','on_demand')),
  status              text NOT NULL CHECK (status IN ('running','completed','failed','partial')),
  window_start        timestamptz NOT NULL,
  window_end          timestamptz NOT NULL,
  line_count_total    integer,
  line_count_matched  integer,
  line_count_unmatched integer,
  line_count_disputed integer,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_break (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  run_id                 text NOT NULL,
  client_id              uuid,
  line_type              text NOT NULL CHECK (line_type IN ('nebras_fees','payment_settlement','consent_record','tpp_aas_pass_through','lfi_access_log')),
  status                 text NOT NULL DEFAULT 'flagged'
                         CHECK (status IN ('flagged','assigned','resolved_matched','resolved_internal_correction','escalated_nebras_dispute','escalated_fintech_billing')),
  variance_amount        bigint,
  variance_currency      char(3),
  variance_count         integer,
  source_a_ref           text NOT NULL,
  source_b_ref           text NOT NULL,
  source_c_ref           text,
  assigned_to            text,
  sla_clock_started_at   timestamptz,
  resolution_outcome     text,
  resolution_note        text,
  nebras_dispute_case_id text,
  reopened_count         integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((variance_amount IS NULL) = (variance_currency IS NULL))
);

CREATE TABLE IF NOT EXISTS dispute_case (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                 uuid NOT NULL,
  channel                 ofbo_channel NOT NULL,
  psu_identifier          text NOT NULL,
  dispute_type            text NOT NULL CHECK (dispute_type IN ('unauthorised_payment','unrecognised_tpp','consent_complaint','data_misuse_complaint','other')),
  state                   text NOT NULL DEFAULT 'open'
                          CHECK (state IN ('open','in_progress','escalated','refund_initiated','resolved','closed')),
  originating_payment_id  uuid,
  originating_consent_id  uuid,
  originating_call_id     text,
  dispute_reason_code     text,
  sla_clock_started_at    timestamptz NOT NULL DEFAULT now(),
  refund_required_by      timestamptz,
  refund_initiated_at     timestamptz,
  refund_amount           bigint,
  refund_currency         char(3),
  nebras_case_id          text,
  care_case_id            text,
  assigned_to             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((refund_amount IS NULL) = (refund_currency IS NULL))
);

-- INSERT-only at every role (PRD §5; BACKOFFICE-45). PII redacted at emission.
CREATE TABLE IF NOT EXISTS audit_high_sensitivity (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                uuid NOT NULL,
  channel                ofbo_channel NOT NULL,
  event_type             text NOT NULL,
  acting_principal       text NOT NULL,
  acting_persona         text NOT NULL,
  scope_used             text NOT NULL,
  target_psu_identifier  text,
  target_consent_id      uuid,
  target_dispute_id      uuid,
  request_trace_id       text NOT NULL,
  request_body_redacted  jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status        integer NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_report (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                 uuid NOT NULL,
  channel                 ofbo_channel NOT NULL,
  report_type             text NOT NULL,
  status                  text NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','generating','awaiting_approval','approved','submitted','rejected','archived')),
  reporting_period_start  timestamptz NOT NULL,
  reporting_period_end    timestamptz NOT NULL,
  classification          text NOT NULL DEFAULT 'confidential-restricted'
                          CHECK (classification IN ('internal-confidential','confidential-restricted','restricted')),
  requested_by            text NOT NULL,
  approved_by             text,
  storage_path            text,
  integrity_hash          text,
  generated_at            timestamptz,
  submitted_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_signal (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  signal_type                text NOT NULL CHECK (signal_type IN ('consent_anomaly','tpp_behaviour','cop_mismatch_spike','nebras_liability_approach','agent_anomaly','predictive_liability_forecast')),
  severity                   text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  status                     text NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','acknowledged','investigating','closed_actioned','closed_no_action','false_positive')),
  client_id                  uuid,
  signal_data                jsonb NOT NULL DEFAULT '{}'::jsonb,
  nebras_liability_event_ref text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_request (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                  uuid NOT NULL,
  channel                  ofbo_channel NOT NULL,
  approval_request_id      text NOT NULL UNIQUE,
  operation_type           text NOT NULL,
  operation_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  state                    text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','timed_out')),
  initiator                text NOT NULL,
  approver_required_scope  text NOT NULL,
  approver                 text,
  expires_at               timestamptz NOT NULL,
  reject_reason            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (approver IS NULL OR approver <> initiator)
);

-- Preventative control for bank_internal_view queries (BACKOFFICE-33) — not audit-only.
CREATE TABLE IF NOT EXISTS query_purpose_registry (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id        uuid NOT NULL,
  channel        ofbo_channel NOT NULL,
  purpose_code   text NOT NULL,
  description    text NOT NULL,
  registered_by  text NOT NULL,
  approved_by    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, purpose_code)
);

CREATE TABLE IF NOT EXISTS tpp_counterparty (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                   uuid NOT NULL,
  channel                   ofbo_channel NOT NULL,
  organisation_id           text NOT NULL,
  legal_name                text NOT NULL,
  registration_number       text,
  directory_contacts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  directory_synced_at       timestamptz,
  production_status         text NOT NULL DEFAULT 'directory_only'
                            CHECK (production_status IN ('directory_only','active_traffic','dormant','decommissioned')),
  first_traffic_at          timestamptz,
  registration_state        text NOT NULL DEFAULT 'unregistered'
                            CHECK (registration_state IN ('unregistered','onboarding','registered','suspended')),
  financial_system_ref      text,
  unbilled_traffic          boolean NOT NULL DEFAULT false,
  mtd_fee_accrual_amount    bigint,
  mtd_fee_accrual_currency  char(3),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, organisation_id),
  CHECK ((mtd_fee_accrual_amount IS NULL) = (mtd_fee_accrual_currency IS NULL))
);

-- Read-only operational mirror of consent lifecycle events (PRD §5): a materialized
-- view over the audit table — never an authority (consent truth lives in the API Hub).
-- NOTE: matviews carry no RLS; SELECT is granted only to bank_internal_view until a
-- tenancy-filtered wrapper lands with the consent stories (M2).
CREATE MATERIALIZED VIEW IF NOT EXISTS consent_admin_event AS
SELECT
  id,
  bank_id,
  channel,
  target_consent_id AS consent_id,
  target_psu_identifier AS psu_identifier,
  event_type,
  acting_principal,
  created_at
FROM audit_high_sensitivity
WHERE event_type IN ('consent_granted','consent_accessed','consent_modified','consent_revoked')
WITH DATA;
