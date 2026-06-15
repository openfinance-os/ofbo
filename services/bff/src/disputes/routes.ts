import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { DisputeListQuery } from '@ofbo/db'
import { DisputeError, DisputeService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-20 — payment investigation view + dispute create/list/get. POST is
 * mutating (Idempotency-Key required). disputes:admin is enforced first by the
 * BFF middleware; the service re-checks it.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof DisputeError) {
    return c.json(
      errorEnvelope(e.code, e.message, 'See the disputes contract (BACKOFFICE-20).', DOCS_BASE),
      e.status as ContentfulStatusCode
    )
  }
  throw e
}

export function disputeRoutes(service: DisputeService, idempotency: IdempotencyStore): Record<string, Handler> {
  const createHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a DisputeCreate body.', DOCS_BASE), 400)
    }
    try {
      const record = await service.create(c.get('principal'), body, trace(c))
      return c.json(dataEnvelope(record), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const withIdempotency: Handler = async (c, params) => {
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
    const cacheKey = `disputes:create|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await createHandler(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }

  return {
    'get /payments/{payment_id}:admin': async (c, params) => {
      try {
        return c.json(dataEnvelope(service.paymentView(c.get('principal'), params.payment_id!)), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /disputes': withIdempotency,

    'get /disputes': async (c) => {
      const q: DisputeListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
        ...(c.req.query('state') ? { state: c.req.query('state') } : {}),
        ...(c.req.query('psu_identifier') ? { psu_identifier: c.req.query('psu_identifier') } : {})
      }
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), q)
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
