/**
 * DEMO-01 — global High-class audit log data layer. Unlike the Dashboard panel (which is
 * scoped to the signed-in principal's own actions), this calls the BFF's GET /audit/events
 * UNFILTERED-by-principal so an auditor can answer "who did X across all reps". Server-side
 * only (httpOnly token → Bearer); audit:read is enforced at the BFF (and the read is itself
 * logged as an audit_trail_accessed event). fetch + base URL injectable for unit tests.
 */
import { bffClient, type BffDeps } from './bff'

/** Mirrors the BFF /audit/events row (toWire). Every field is non-PII (redacted at emission). */
export interface AuditLogEvent {
  id: string
  event_type: string
  acting_principal: string | null
  acting_persona: string | null
  scope_used: string | null
  target_psu_identifier: string | null
  target_consent_id: string | null
  request_trace_id: string | null
  response_status: number | null
  created_at: string
}

/** Curated filter options for the UI dropdown ('' = all event types). */
export const AUDIT_EVENT_TYPES = [
  '',
  'consent_revoked',
  'consent_granted',
  'consent_accessed',
  'consent_modified',
  'dispute_opened',
  'refund_initiated',
  'signin_success',
  'scope_denied',
  'audit_trail_accessed'
] as const

export class AuditLogError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface AuditLogDeps extends BffDeps {
  traceId?: string
}

export interface AuditLogFilters {
  eventType?: string
  actingPrincipal?: string
  limit?: number
}

/** GET /audit/events (audit:read). Returns the events array; meta.next_cursor is ignored here. */
export async function searchAuditEvents(token: string, filters: AuditLogFilters = {}, deps: AuditLogDeps = {}): Promise<AuditLogEvent[]> {
  const { base, f } = bffClient(deps)
  const trace = deps.traceId ?? crypto.randomUUID()
  const params = new URLSearchParams()
  if (filters.eventType) params.set('event_type', filters.eventType)
  if (filters.actingPrincipal) params.set('acting_principal', filters.actingPrincipal)
  params.set('limit', String(filters.limit ?? 100))
  const res = await f(`${base}/audit/events?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace }
  })
  const body = (await res.json().catch(() => ({}))) as { data?: AuditLogEvent[]; error?: { code?: string; message?: string } }
  if (!res.ok) throw new AuditLogError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  return body.data ?? []
}
