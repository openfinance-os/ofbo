import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ServiceDeskError, ServiceDeskService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-79 — Nebras service-desk case tracking. POST track + POST :update are
 * mutating (Idempotency-Key required). platform:operations:read gates list/detail;
 * platform:operations:write gates track/update — BFF middleware enforces first, the
 * service re-checks.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof ServiceDeskError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the service-desk-case contract (BACKOFFICE-79).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function serviceDeskRoutes(service: ServiceDeskService, idempotency: IdempotencyStore): Record<string, Handler> {
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
      const cacheKey = `${routeKey}|${params.case_id ?? ''}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const res = await handler(c, params)
      if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
      return res
    }

  const trackHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a ServiceDeskCaseCreate body.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.track(c.get('principal'), body, trace(c))), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const updateHandler: Handler = async (c, params) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { status?, priority?, note }.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.update(c.get('principal'), params.case_id!, body, trace(c))), 200)
    } catch (e) {
      return fail(c, e)
    }
  }

  return {
    'post /back-office/service-desk-cases': withIdempotency('service-desk:track', trackHandler),

    'post /back-office/service-desk-cases/{case_id}:update': withIdempotency('service-desk:update', updateHandler),

    'get /back-office/service-desk-cases': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
          ...(c.req.query('case_type') ? { case_type: c.req.query('case_type') } : {}),
          ...(c.req.query('priority') ? { priority: c.req.query('priority') } : {}),
          ...(c.req.query('status') ? { status: c.req.query('status') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/service-desk-cases/{case_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(await service.get(c.get('principal'), params.case_id!)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
