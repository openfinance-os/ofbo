/**
 * High-class audit sink for story services (BACKOFFICE-45). Structurally matches
 * @ofbo/db's PgAuditEmitter.emit — the worker passes that emitter (PII redacted +
 * lineage at write time); tests use the in-memory sink below. Kept separate from
 * the auth-lifecycle AuthAuditSink (auth.ts), which carries a fixed event union.
 */
export interface HighClassAuditEvent {
  event_type: string
  acting_principal: string
  acting_persona: string
  scope_used: string
  target_psu_identifier?: string | null
  target_consent_id?: string | null
  target_dispute_id?: string | null
  request_trace_id: string
  request_body?: unknown
  response_status: number
  superadmin_marker?: boolean
}

export interface HighClassAuditSink {
  emit(event: HighClassAuditEvent): Promise<void>
}

export class InMemoryHighClassAuditSink implements HighClassAuditSink {
  readonly events: HighClassAuditEvent[] = []
  async emit(event: HighClassAuditEvent): Promise<void> {
    this.events.push(event)
  }
}

/** True when a sink also exposes the High-class emit path (e.g. PgAuditEmitter). */
export function hasHighClassEmit(sink: unknown): sink is HighClassAuditSink {
  return typeof (sink as { emit?: unknown })?.emit === 'function'
}
