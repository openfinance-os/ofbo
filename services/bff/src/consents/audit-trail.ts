import type { Context } from 'hono'
import type { ConsentEventPage, ConsentEventQuery } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError } from '../rbac.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'

/**
 * BACKOFFICE-19 — 24-month consent audit-trail timeline (per consent and
 * per PSU), chronological with cursor pagination. Read-only over the High-class
 * audit store; `audit:read` is enforced by the BFF middleware (static scope) and
 * re-checked here (defence in depth). Each event's `id` is the audit row id, the
 * anchor for one-click drill-down to the full record (GET /audit/events/{id}).
 */

export const AUDIT_TRAIL_SCOPE = 'audit:read'

export interface ConsentEventSource {
  byConsent(consentId: string, query: ConsentEventQuery): Promise<ConsentEventPage>
  byPsu(psuIdentifier: string, query: ConsentEventQuery): Promise<ConsentEventPage>
}

/** Degraded default (no DATABASE_URL): an empty, well-formed timeline. */
export class InMemoryConsentEventSource implements ConsentEventSource {
  async byConsent(): Promise<ConsentEventPage> {
    return { events: [], next_cursor: null }
  }
  async byPsu(): Promise<ConsentEventPage> {
    return { events: [], next_cursor: null }
  }
}

export class ConsentAuditTrailService {
  constructor(private readonly source: ConsentEventSource) {}

  byConsent(principal: Principal, consentId: string, query: ConsentEventQuery): Promise<ConsentEventPage> {
    assertScope(principal, AUDIT_TRAIL_SCOPE)
    return this.source.byConsent(consentId, query)
  }

  byPsu(principal: Principal, psuIdentifier: string, query: ConsentEventQuery): Promise<ConsentEventPage> {
    assertScope(principal, AUDIT_TRAIL_SCOPE)
    return this.source.byPsu(psuIdentifier, query)
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

function pageQuery(c: Context): ConsentEventQuery {
  const cursor = c.req.query('cursor')
  const limitRaw = c.req.query('limit')
  return {
    ...(cursor ? { cursor } : {}),
    ...(limitRaw ? { limit: Number(limitRaw) } : {})
  }
}

export function consentAuditTrailRoutes(service: ConsentAuditTrailService): Record<string, Handler> {
  const respond = async (fn: () => Promise<ConsentEventPage>, c: Context): Promise<Response> => {
    try {
      const page = await fn()
      return c.json(dataEnvelope(page.events, { next_cursor: page.next_cursor }), 200)
    } catch (e) {
      if (e instanceof ScopeDeniedError) {
        return c.json(
          errorEnvelope('BACKOFFICE.SCOPE_DENIED', e.message, 'This timeline requires the audit:read scope.', DOCS_BASE, {
            required_scope: AUDIT_TRAIL_SCOPE
          }),
          403
        )
      }
      throw e
    }
  }

  return {
    'get /consents/{consent_id}/audit-trail': (c, params) =>
      respond(() => service.byConsent(c.get('principal'), params.consent_id!, pageQuery(c)), c),
    'get /psu/{psu_identifier}/audit-trail': (c, params) =>
      respond(() => service.byPsu(c.get('principal'), params.psu_identifier!, pageQuery(c)), c)
  }
}
