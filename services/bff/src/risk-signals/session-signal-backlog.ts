import type { StoredRiskSignal } from '@ofbo/db'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE, type HighClassAuditSink } from '../high-class-audit.js'

/**
 * BACKOFFICE-80 — drain the "super-admin session active" signals written before the durable
 * once-per-session dedupe.
 *
 * The guardrail raised one open info signal per REQUEST rather than per session (its memory lived
 * on an app the Worker rebuilds per request), and the executive dashboard, which reads every open
 * signal, slowed with each one. The dedupe stops new duplicates; this closes the old ones.
 *
 * Deliberately NOT a migration. A migration writes as the privileged migration role, outside RLS
 * and outside the CODE-03 checks on who may write `audit_high_sensitivity` and with what scope.
 * This runs as `ofbo_app` through the store's status transition, and writes one High-class audit
 * event PER SIGNAL naming it, the way the analyst triage path does
 * (services/bff/src/risk-signals/service.ts) — so the trail can say which regulated record moved,
 * from what, to what, and why. A headless actor holds no scope, so it records the system sentinel
 * and no HTTP status rather than borrowing a Risk analyst's authority.
 *
 * Nothing is deleted and the signal body is not edited: only `status` moves, through a lifecycle
 * the table already has. The earliest signal per principal per 8-hour session window stays open,
 * so the Risk View still shows that the role was active, and when.
 *
 * Idempotent and resumable (CLAUDE.md, demo-profile scheduled jobs): each run takes a bounded batch
 * of the oldest remaining duplicates, and the transition applies only to a signal still `open`.
 */

const RUN_PRINCIPAL = 'system:superadmin-session-signal-dedupe'
const FROM_STATUS = 'open'
const TO_STATUS = 'closed_no_action'

export interface SessionSignalBacklogStore {
  duplicateSuperAdminSessionSignalIds(limit: number): Promise<string[]>
  transitionSignalStatus(id: string, from: string, to: string): Promise<StoredRiskSignal | null>
}

export interface SessionSignalBacklogDeps {
  store: SessionSignalBacklogStore
  audit: HighClassAuditSink
}

/** Close one batch of duplicates; returns how many this run closed (0 once drained). */
export async function closeDuplicateSessionSignals(
  deps: SessionSignalBacklogDeps,
  traceId: string,
  batchSize = 100
): Promise<number> {
  const ids = await deps.store.duplicateSuperAdminSessionSignalIds(batchSize)
  let closed = 0
  for (const id of ids) {
    const updated = await deps.store.transitionSignalStatus(id, FROM_STATUS, TO_STATUS)
    // Triaged by an analyst since the batch was read — theirs stands, and there is nothing to audit.
    if (!updated) continue
    await deps.audit.emit({
      event_type: 'risk_signal_status_changed',
      acting_principal: RUN_PRINCIPAL,
      acting_persona: 'system',
      scope_used: SYSTEM_ACTOR_SCOPE,
      request_trace_id: traceId,
      request_body: {
        signal_id: id,
        signal_type: updated.signal_type,
        from_status: FROM_STATUS,
        to_status: TO_STATUS,
        reason: 'duplicate_superadmin_session_signal'
      },
      response_status: SYSTEM_ACTOR_RESPONSE_STATUS
    })
    closed++
  }
  return closed
}
