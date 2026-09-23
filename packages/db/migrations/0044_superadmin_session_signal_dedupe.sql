-- BACKOFFICE-80 — close the duplicate "super-admin session active" signals, and index the reads
-- that keep them from coming back.
--
-- The guardrail meant to raise ONE informational signal per super-admin session raised one per
-- REQUEST on the deployed BFF: its once-per-session memory lived on an app the Worker rebuilds for
-- every request, so it never remembered the previous one. The hosted demo accumulated ~1,700 open
-- info signals that way, and the executive dashboard, which pages through every open signal, went
-- from sub-second to ~40s for the one persona entitled to read them. The emitter now dedupes
-- durably (PgRiskSignalEmitter.recordOnce, keyed by `signal_data->>'dedup_key'`); this migration
-- deals with the rows written before it did.
--
-- NOTHING IS DELETED. risk_signal is a regulated record with no deletion path (CLAUDE.md retention
-- hard stop). The duplicates are moved through the status lifecycle the table already has — to
-- `closed_no_action`, the same transition an analyst's triage would make — with the reason stamped
-- into signal_data, and every closure is accounted for in the High-class audit trail below.
--
-- What counts as a duplicate: an OPEN super-admin session signal written before the dedupe (no
-- dedup_key) that is not the earliest one for its principal within an 8-hour bucket (the
-- guardrail's session window). The earliest per bucket stays open, so the Risk View still shows
-- that the role was active, and when — which is what the signal exists to say.

CREATE TEMP TABLE _sa_session_dupes ON COMMIT DROP AS
SELECT id, bank_id, channel
  FROM (
    SELECT id, bank_id, channel,
           row_number() OVER (
             PARTITION BY bank_id,
                          signal_data->>'acting_principal',
                          floor(extract(epoch FROM created_at) / 28800)
             ORDER BY created_at, id
           ) AS rn
      FROM risk_signal
     WHERE signal_type = 'agent_anomaly'
       AND severity = 'info'
       AND status = 'open'
       AND signal_data->>'summary' = 'super-admin session active'
       AND signal_data->>'dedup_key' IS NULL
  ) ranked
 WHERE rn > 1;

UPDATE risk_signal r
   SET status = 'closed_no_action',
       signal_data = r.signal_data || jsonb_build_object(
         'closed_reason', 'duplicate super-admin session signal (per-request guardrail defect) — closed by migration 0044',
         'closed_by_migration', '0044_superadmin_session_signal_dedupe'
       )
  FROM _sa_session_dupes d
 WHERE r.id = d.id;

-- One High-class audit row per tenant for the bulk transition — the same event type the triage
-- path emits per signal (services/bff/src/risk-signals/service.ts), carrying the count instead of
-- one row per duplicate. No PII: principals are synthetic demo subjects and are not copied here.
INSERT INTO audit_high_sensitivity
  (bank_id, channel, event_type, acting_principal, acting_persona, scope_used,
   request_trace_id, request_body_redacted, response_status)
SELECT bank_id, channel, 'risk_signal_status_changed', 'system:migration', 'system', 'risk:investigations:write',
       'migration-0044-superadmin-session-signal-dedupe',
       jsonb_build_object(
         'migration', '0044_superadmin_session_signal_dedupe',
         'signal_type', 'agent_anomaly',
         'from_status', 'open',
         'to_status', 'closed_no_action',
         'signals_closed', count(*)
       ),
       200
  FROM _sa_session_dupes
 GROUP BY bank_id, channel;

-- The durable dedupe looks up by key inside a window on every super-admin session start.
CREATE INDEX IF NOT EXISTS risk_signal_dedup_key_idx
  ON risk_signal ((signal_data->>'dedup_key'), created_at)
  WHERE signal_data->>'dedup_key' IS NOT NULL;

-- The signal list (and the dashboard's open-signal read) filters by status and keysets on
-- (created_at, id) descending.
CREATE INDEX IF NOT EXISTS risk_signal_status_created_idx
  ON risk_signal (bank_id, status, created_at DESC, id DESC);
