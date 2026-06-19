import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { FraudIncidentError, FraudIncidentService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'

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
  const withIdempotency =
    (routeKey: string, handler: Handler): Handler =>
    async (c, params) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope(
            'BACKOFFICE.MISSING_IDEMPOTENCY_KEY',
            'The Idempotency-Key header is required on every mutating endpoint.',
            'Send a unique Idempotency-Key; replays within 24h return the original result.',
            DOCS_BASE
          ),
          400
        )
      }
      const cacheKey = `${routeKey}|${params.incident_id ?? ''}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const res = await handler(c, params)
      if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
      return res
    }

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
          ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
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
