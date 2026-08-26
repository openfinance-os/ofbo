-- BILL-04: immutable PINT AE document artifacts and append-only ASP delivery attempts.
-- A retry submits the exact stored bytes; it never regenerates an invoice or overwrites history.

CREATE UNIQUE INDEX IF NOT EXISTS invoice_run_tenant_id_uidx ON invoice_run (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_einvoice_document (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  invoice_run_id        uuid NOT NULL,
  expected_memo_id      uuid,
  document_id           text NOT NULL,
  document_uuid         uuid NOT NULL,
  document_type         text NOT NULL CHECK (document_type IN ('380','381')),
  pint_ae_version       text NOT NULL CHECK (pint_ae_version = '1.0.3'),
  customization_id      text NOT NULL CHECK (customization_id = 'urn:peppol:pint:billing-1@ae-1'),
  profile_id            text NOT NULL CHECK (profile_id = 'urn:peppol:bis:billing'),
  transaction_type      text NOT NULL CHECK (transaction_type ~ '^[01]{8}$'),
  billing_period        text NOT NULL CHECK (billing_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  issue_date            date NOT NULL,
  buyer_id              text NOT NULL,
  tax_category          text NOT NULL CHECK (tax_category IN ('S','Z')),
  gross_fils            bigint NOT NULL CHECK (gross_fils >= 0),
  net_fils              bigint NOT NULL CHECK (net_fils >= 0),
  vat_fils              bigint NOT NULL CHECK (vat_fils >= 0),
  tdd_required          boolean NOT NULL CHECK (tdd_required),
  vat_posture_decision_ref text NOT NULL,
  einvoicing_mode       text NOT NULL CHECK (einvoicing_mode IN ('voluntary_pilot','mandatory')),
  source_line_refs      text[] NOT NULL,
  withheld_payload      jsonb NOT NULL DEFAULT '[]'::jsonb,
  xml_payload           text NOT NULL,
  xml_sha256            text NOT NULL CHECK (xml_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  pdf_payload           bytea NOT NULL,
  pdf_sha256            text NOT NULL CHECK (pdf_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  CHECK (gross_fils = net_fils + vat_fils),
  FOREIGN KEY (bank_id, invoice_run_id) REFERENCES invoice_run(bank_id, id),
  FOREIGN KEY (bank_id, expected_memo_id) REFERENCES billing_expected_memo(bank_id, id),
  UNIQUE (bank_id, document_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_einvoice_document_tenant_id_uidx
  ON billing_einvoice_document (bank_id, id);

CREATE TABLE IF NOT EXISTS billing_asp_submission (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id               uuid NOT NULL,
  channel               ofbo_channel NOT NULL,
  einvoice_document_id  uuid NOT NULL,
  attempt_no            integer NOT NULL CHECK (attempt_no > 0),
  adapter_profile       text NOT NULL CHECK (adapter_profile IN ('demo','enterprise')),
  fapi_interaction_id   text NOT NULL,
  accepted              boolean NOT NULL,
  submission_ref        text,
  document_status       text NOT NULL CHECK (document_status IN ('accepted','rejected','transport_error')),
  tdd_status            text NOT NULL CHECK (tdd_status IN ('reported','pending','rejected','not_sent')),
  error_detail          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  classification        ofbo_classification NOT NULL DEFAULT 'confidential-restricted',
  FOREIGN KEY (bank_id, einvoice_document_id) REFERENCES billing_einvoice_document(bank_id, id),
  UNIQUE (bank_id, einvoice_document_id, attempt_no),
  CHECK ((document_status = 'transport_error') = (error_detail IS NOT NULL))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_einvoice_document','billing_asp_submission'] LOOP
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
  ('billing_einvoice_document', 24, 60),
  ('billing_asp_submission', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_einvoice_document', 'confidential-restricted'),
  ('billing_asp_submission', 'confidential-restricted')
ON CONFLICT (table_name) DO NOTHING;
