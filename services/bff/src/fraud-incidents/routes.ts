import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { FraudIncidentError, FraudIncidentService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-77 — fraud-incident reporting. POST report + POST :resolve are
 * mutating (Idempotency-Key required). risk:read gates the list; risk:investigations:write
 * gates report/resolve — enforced first by the BFF middleware, re-checked in the service.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof FraudIncidentError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the fraud-incident contract (BACKOFFICE-77).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function fraudIncidentRoutes(service: FraudIncidentService, idempotency: IdempotencyStore): Record<string, Handler> {
  const withIdempotency = (routeKey: string, handler: Handler): Handler =>
    replayable(idempotency, (params, subject, key) => `${routeKey}|${params.incident_id ?? ''}|${subject}|${key}`, handler)

  const reportHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a fraud-incident body.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.report(c.get('principal'), body, trace(c))), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const resolveHandler: Handler = async (c, params) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { resolution_note }.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.resolve(c.get('principal'), params.incident_id!, body, trace(c))), 200)
    } catch (e) {
      return fail(c, e)
    }
  }

  return {
    'post /back-office/fraud-incidents': withIdempotency('fraud-incidents:report', reportHandler),

    'post /back-office/fraud-incidents/{incident_id}:resolve': withIdempotency('fraud-incidents:resolve', resolveHandler),

    'get /back-office/fraud-incidents': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...limitParam(c.req.query('limit')),
          ...(c.req.query('status') ? { status: c.req.query('status') } : {}),
          ...(c.req.query('nebras_severity') ? { nebras_severity: c.req.query('nebras_severity') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
