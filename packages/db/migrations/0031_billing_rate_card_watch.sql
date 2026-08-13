-- BILL-01: durable scheme rate-card versions and upstream change watch.
-- Versions and source snapshots are immutable facts. Reviews are mutable only for
-- recipient delivery state and later human disposition. All three tables are tenant
-- scoped from creation and carry retention, classification and write-time lineage.

CREATE TABLE IF NOT EXISTS billing_rate_card_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id          uuid NOT NULL,
  channel          ofbo_channel NOT NULL,
  version          text NOT NULL,
  effective_from   date NOT NULL,
  source_url       text NOT NULL,
  config_hash      text NOT NULL,
  card_config      jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  classification   ofbo_classification NOT NULL DEFAULT 'internal-confidential',
  UNIQUE (bank_id, version)
);

CREATE TABLE IF NOT EXISTS billing_source_snapshot (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id          uuid NOT NULL,
  channel          ofbo_channel NOT NULL,
  source_name      text NOT NULL,
  source_url       text NOT NULL,
  content_hash     text NOT NULL,
  content_text     text NOT NULL,
  http_status      integer NOT NULL CHECK (http_status BETWEEN 200 AND 299),
  etag             text,
  last_modified    text,
  captured_at      timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  classification   ofbo_classification NOT NULL DEFAULT 'internal-confidential',
  UNIQUE (bank_id, source_url, content_hash, captured_at)
);

CREATE INDEX IF NOT EXISTS billing_source_snapshot_latest_idx
  ON billing_source_snapshot (bank_id, source_url, captured_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_rate_card_review (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id                    uuid NOT NULL,
  channel                    ofbo_channel NOT NULL,
  source_name                text NOT NULL,
  source_url                 text NOT NULL,
  previous_snapshot_id       uuid NOT NULL REFERENCES billing_source_snapshot(id),
  current_snapshot_id        uuid NOT NULL REFERENCES billing_source_snapshot(id),
  previous_hash              text NOT NULL,
  current_hash               text NOT NULL,
  detected_at                timestamptz NOT NULL,
  changes                    jsonb NOT NULL,
  review_class               text NOT NULL DEFAULT 'High' CHECK (review_class = 'High'),
  status                     text NOT NULL DEFAULT 'notification_pending'
                             CHECK (status IN ('notification_pending','notified','approved','rejected')),
  notify_audiences           text[] NOT NULL DEFAULT ARRAY['Finance','Compliance']::text[],
  finance_ticket_id          text,
  compliance_ticket_id       text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  classification             ofbo_classification NOT NULL DEFAULT 'internal-confidential',
  CHECK (previous_hash <> current_hash),
  UNIQUE (bank_id, previous_snapshot_id, current_snapshot_id)
);

CREATE INDEX IF NOT EXISTS billing_rate_card_review_pending_idx
  ON billing_rate_card_review (bank_id, status, detected_at);

-- RLS and least privilege. Version/snapshot facts are INSERT-only; review rows may
-- update notification/disposition fields but cannot be deleted by the application.
DO $$
DECLARE
  immutable_table text;
BEGIN
  FOREACH immutable_table IN ARRAY ARRAY['billing_rate_card_version', 'billing_source_snapshot']
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

ALTER TABLE billing_rate_card_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rate_card_review FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tenancy_select ON billing_rate_card_review FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenancy_insert ON billing_rate_card_review FOR INSERT TO ofbo_app
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenancy_update ON billing_rate_card_review FOR UPDATE TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid)
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY internal_view_select ON billing_rate_card_review FOR SELECT TO bank_internal_view USING (
    NULLIF(current_setting('app.tenant_group', true), '') IS NULL
    OR bank_id IN (
      SELECT m.bank_id FROM tenant_group_member m
      WHERE m.tenant_group_id = NULLIF(current_setting('app.tenant_group', true), '')::uuid
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE ON billing_rate_card_review TO ofbo_app;
GRANT SELECT ON billing_rate_card_review TO bank_internal_view;

INSERT INTO retention_policy (table_name, hot_months, immutable_months) VALUES
  ('billing_rate_card_version', 24, 60),
  ('billing_source_snapshot', 24, 60),
  ('billing_rate_card_review', 24, 60)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO classification_policy (table_name, floor) VALUES
  ('billing_rate_card_version', 'internal-confidential'),
  ('billing_source_snapshot', 'internal-confidential'),
  ('billing_rate_card_review', 'internal-confidential')
ON CONFLICT (table_name) DO NOTHING;
