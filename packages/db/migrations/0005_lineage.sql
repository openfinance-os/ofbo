-- BACKOFFICE-49: demo-profile P7 adapter target — column-level BCBS 239 lineage
-- written at write time, browsable from the Compliance View (M4). Enterprise
-- swap (M6) replaces the table with the bank's data catalogue feed.

CREATE TABLE IF NOT EXISTS lineage_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id     uuid NOT NULL,
  channel     ofbo_channel NOT NULL,
  table_name  text NOT NULL,
  columns     text[] NOT NULL,
  source      text NOT NULL,
  trace_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lineage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineage_events FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenancy_select ON lineage_events FOR SELECT TO ofbo_app
    USING (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenancy_insert ON lineage_events FOR INSERT TO ofbo_app
    WITH CHECK (bank_id = NULLIF(current_setting('app.bank_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY internal_view_select ON lineage_events FOR SELECT TO bank_internal_view USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON lineage_events TO ofbo_app;
GRANT SELECT ON lineage_events TO bank_internal_view;
-- lineage is evidence: no UPDATE/DELETE for anyone
REVOKE UPDATE, DELETE ON lineage_events FROM PUBLIC, ofbo_app, bank_internal_view;
