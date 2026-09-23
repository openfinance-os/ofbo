-- BACKOFFICE-80 — index the reads behind the durable super-admin session dedupe.
--
-- The guardrail meant to raise ONE informational signal per super-admin session raised one per
-- REQUEST on the deployed BFF (its memory lived on an app the Worker rebuilds per request). The
-- emitter now dedupes durably — PgRiskSignalEmitter.recordOnce looks up `signal_data->>'dedup_key'`
-- inside the session window on every super-admin session start — and the dashboard reads the open
-- signal list by status.
--
-- Schema only. The duplicates written before the fix are closed by a scheduled job through the
-- store's status transition, one High-class audit event per signal under the system-actor
-- convention (services/bff/src/risk-signals/session-signal-backlog.ts) — never by a migration,
-- which would write the regulated trail as the privileged migration role, outside the CODE-03
-- checks.

CREATE INDEX IF NOT EXISTS risk_signal_dedup_key_idx
  ON risk_signal ((signal_data->>'dedup_key'), created_at)
  WHERE signal_data->>'dedup_key' IS NOT NULL;

CREATE INDEX IF NOT EXISTS risk_signal_status_created_idx
  ON risk_signal (bank_id, status, created_at DESC, id DESC);
