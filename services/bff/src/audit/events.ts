import type { Context } from 'hono'
import type { StoredAuditEvent, AuditEventQuery } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied, domainError } from '../errors.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { dataEnvelope } from '../envelope.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-42 — audit-trail drill-down from the Compliance and Risk Views. A signal
 * or report links to its underlying High-class audit record(s): GET /audit/events
 * (filtered, cursor-paginated) + GET /audit/events/{event_id}. audit:read at the BFF
 * middleware AND the service. The drill-down access is ITSELF logged (an
 * audit_trail_accessed High-class event), so reads of the regulated trail are auditable.
 * PII was redacted at emission, so the stored records are returned as-is.
 */

export const AUDIT_READ_SCOPE = 'audit:read'

export class AuditEventError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface AuditEventReader {
  query(filters: AuditEventQuery): Promise<{ rows: StoredAuditEvent[]; next_cursor: string | null }>
  get(id: string): Promise<StoredAuditEvent | null>
}

export interface AuditEventsDeps {
  reader: AuditEventReader
  audit: HighClassAuditSink
}

export function toWire(e: StoredAuditEvent) {
  return {
    id: e.id,
    event_type: e.event_type,
    acting_principal: e.acting_principal,
    acting_persona: e.acting_persona,
    scope_used: e.scope_used,
    target_psu_identifier: e.target_psu_identifier,
    target_consent_id: e.target_consent_id,
    target_dispute_id: e.target_dispute_id,
    request_trace_id: e.request_trace_id,
    superadmin_marker: e.superadmin_marker,
    request_body_redacted: e.request_body_redacted,
    response_status: e.response_status,
    created_at: e.created_at
  }
}

export class AuditEventsService {
  constructor(private readonly deps: AuditEventsDeps) {}

  async query(principal: Principal, filters: AuditEventQuery, traceId: string): Promise<{ rows: StoredAuditEvent[]; next_cursor: string | null }> {
    assertScope(principal, AUDIT_READ_SCOPE)
    const page = await this.deps.reader.query(filters)
    await this.logAccess(principal, { kind: 'query', filters: { acting_principal: filters.acting_principal, event_type: filters.event_type, has_psu_filter: !!filters.target_psu_identifier, from: filters.from, to: filters.to }, returned: page.rows.length }, traceId)
    return page
  }

  async get(principal: Principal, id: string, traceId: string): Promise<StoredAuditEvent> {
    assertScope(principal, AUDIT_READ_SCOPE)
    const event = await this.deps.reader.get(id)
    if (!event) throw new AuditEventError('BACKOFFICE.AUDIT_EVENT_NOT_FOUND', `No audit event ${id}.`, 404)
    await this.logAccess(principal, { kind: 'get', event_id: id }, traceId)
    return event
  }

  /** The drill-down itself is logged (BACKOFFICE-42) — an INSERT-only High-class record. */
  private async logAccess(principal: Principal, body: Record<string, unknown>, traceId: string): Promise<void> {
    await this.deps.audit.emit({
      event_type: 'audit_trail_accessed',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: AUDIT_READ_SCOPE,
      request_trace_id: traceId,
      request_body: body,
      response_status: 200,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>
const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof AuditEventError) return domainError(c, e, 'List events at GET /audit/events.')
  throw e
}

export function auditEventsRoutes(service: AuditEventsService): Record<string, Handler> {
  return {
    'get /audit/events': async (c) => {
      const q: AuditEventQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...limitParam(c.req.query('limit')),
        ...(c.req.query('acting_principal') ? { acting_principal: c.req.query('acting_principal') } : {}),
        ...(c.req.query('target_psu_identifier') ? { target_psu_identifier: c.req.query('target_psu_identifier') } : {}),
        ...(c.req.query('event_type') ? { event_type: c.req.query('event_type') } : {}),
        ...(c.req.query('from') ? { from: c.req.query('from') } : {}),
        ...(c.req.query('to') ? { to: c.req.query('to') } : {})
      }
      try {
        const { rows, next_cursor } = await service.query(c.get('principal'), q, trace(c))
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /audit/events/{event_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.get(c.get('principal'), params.event_id!, trace(c)))), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}

/** No-database default (tests / local dev). */
export class InMemoryAuditEventReader implements AuditEventReader {
  constructor(private readonly rows: StoredAuditEvent[] = []) {}
  async query(filters: AuditEventQuery): Promise<{ rows: StoredAuditEvent[]; next_cursor: string | null }> {
    let rows = [...this.rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (filters.acting_principal) rows = rows.filter((r) => r.acting_principal === filters.acting_principal)
    if (filters.target_psu_identifier) rows = rows.filter((r) => r.target_psu_identifier === filters.target_psu_identifier)
    if (filters.event_type) rows = rows.filter((r) => r.event_type === filters.event_type)
    return { rows: rows.slice(0, Math.min(Math.max(filters.limit ?? 50, 1), 200)), next_cursor: null }
  }
  async get(id: string): Promise<StoredAuditEvent | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
}
