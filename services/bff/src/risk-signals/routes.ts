import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { RiskSignalError, RiskSignalService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-30 / -42 — GET /back-office/risk-signals (risk:read, cursor paginated) +
 * PATCH /back-office/risk-signals/{signal_id} (risk:investigations:write, Idempotency-Key).
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>
const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof RiskSignalError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the risk-signals contract (BACKOFFICE-30/-42).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function riskSignalRoutes(service: RiskSignalService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/risk-signals': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
          ...(c.req.query('signal_type') ? { signal_type: c.req.query('signal_type') } : {}),
          ...(c.req.query('severity') ? { severity: c.req.query('severity') } : {}),
          ...(c.req.query('status') ? { status: c.req.query('status') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'patch /back-office/risk-signals/{signal_id}': async (c, params) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE), 400)
      }
      const cacheKey = `risk-signals:patch|${params.signal_id}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)

      let body: { status?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { status }.', DOCS_BASE), 400)
      }
      try {
        const record = await service.updateStatus(c.get('principal'), params.signal_id!, body, trace(c))
        const res = c.json(dataEnvelope(record), 200)
        await idempotency.set(cacheKey, 200, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
