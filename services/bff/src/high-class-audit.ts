/**
 * High-class audit sink for story services (BACKOFFICE-45). Structurally matches
 * @ofbo/db's PgAuditEmitter.emit — the worker passes that emitter (PII redacted +
 * lineage at write time); tests use the in-memory sink below. Kept separate from
 * the auth-lifecycle AuthAuditSink (auth.ts), which carries a fixed event union.
 */
/**
 * CODE-03 — the `scope_used` value for an actor that no scope authorised.
 *
 * Scheduled jobs run on no principal's authority, so there is no scope to record. Six invented
 * tokens (`billing:rate`, `billing:post`, `reconciliation:run`, …) accumulated across fourteen sites
 * trying to say otherwise; none was ever passed to `assertScope`, so none granted anything — they
 * simply named scopes an auditor cannot resolve against the contract, permanently, in an INSERT-only
 * table with no deletion path.
 *
 * A single declared sentinel is the honest record. The job's identity is not lost by it: it is
 * already carried twice, in `acting_principal` (`system:billing-rating-engine`) and in `event_type`.
 */
export const SYSTEM_ACTOR_SCOPE = 'system'

/**
 * CODE-03 — the `response_status` for an actor that issues no HTTP response.
 *
 * `response_status` is an HTTP-shaped column, NOT NULL in a regulated INSERT-only table. A scheduled
 * job that returns nothing to anyone was stamping 200 or 201, and one site stamped 200 on a path
 * reporting a SKIP — wrong on its own terms. Zero is not a status code, which is precisely why it
 * can mean "no HTTP response was issued" without colliding with one, and it satisfies NOT NULL
 * without relaxing a constraint on regulated evidence.
 */
export const SYSTEM_ACTOR_RESPONSE_STATUS = 0

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
