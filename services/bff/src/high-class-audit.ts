/**
 * High-class audit sink for story services (BACKOFFICE-45). Structurally matches
 * @ofbo/db's PgAuditEmitter.emit — the worker passes that emitter (PII redacted +
 * lineage at write time); tests use the in-memory sink below. Kept separate from
 * the auth-lifecycle AuthAuditSink (auth.ts), which carries a fixed event union.
 */
/**
 * CODE-03 sentinels, re-exported from @ofbo/db where they are declared.
 *
 * They live there because audit_high_sensitivity is written from both trees through the same
 * emitter; declaring them BFF-side is what left packages/db's own emitters outside the convention.
 * Re-exported here so every existing import site is unchanged.
 */
export { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '@ofbo/db'

export interface HighClassAuditEvent {
  event_type: string
  acting_principal: string
  acting_persona: string
  /** A declared scope, or SYSTEM_ACTOR_SCOPE when no principal's authority is involved. */
  scope_used: string
  target_psu_identifier?: string | null
  target_consent_id?: string | null
  target_dispute_id?: string | null
  request_trace_id: string
  request_body?: unknown
  /** An HTTP status, or SYSTEM_ACTOR_RESPONSE_STATUS for an actor that issues no HTTP response. */
  response_status: number
  superadmin_marker?: boolean
  /** BACKOFFICE-59 — stamped by the training environment's sink; a training action is thereby
   *  distinguishable and is NEVER written to the production audit_high_sensitivity trail. */
  training?: boolean
}

export interface HighClassAuditSink {
  emit(event: HighClassAuditEvent): Promise<void>
}


/** True when a sink also exposes the High-class emit path (e.g. PgAuditEmitter). */
export function hasHighClassEmit(sink: unknown): sink is HighClassAuditSink {
  return typeof (sink as { emit?: unknown })?.emit === 'function'
}

// CODE-02 — in-memory store(s) moved to services/bff/memory/high-class-audit.ts (demo-profile production
// defaults, not test fixtures). Re-exported so every existing import is unchanged.
export {
  InMemoryHighClassAuditSink
} from '../memory/high-class-audit.js'
