import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { CareSurfaceError, type CareSurfaceService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-25 — POST /care-surface:mint-token. Mutating (mints a token + writes
 * audit), so an Idempotency-Key is mandatory; a replay returns the original token.
 * The replay key is scoped by the caller and the Idempotency-Key only — never the
 * raw psu_identifier (which may be PII).
 */

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function careSurfaceRoutes(service: CareSurfaceService, idempotency: IdempotencyStore): Record<string, Handler> {
  const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

  const handler: Handler = async (c) => {
    let body: { identifier_type?: string; psu_identifier?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { identifier_type, psu_identifier }.', DOCS_BASE), 400)
    }
    if (!body.identifier_type || !body.psu_identifier) {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'identifier_type and psu_identifier are required.', 'Send { identifier_type, psu_identifier }.', DOCS_BASE), 400)
    }
    try {
      const token = await service.mintToken(c.get('principal'), { identifier_type: body.identifier_type, psu_identifier: body.psu_identifier }, trace(c))
      return c.json(dataEnvelope(token), 200)
    } catch (e) {
      if (e instanceof CareSurfaceError) {
        return c.json(errorEnvelope(e.code, e.message, 'See the care-surface token contract (BACKOFFICE-25).', DOCS_BASE), e.status as ContentfulStatusCode)
      }
      throw e
    }
  }

  const withIdempotency: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(
        errorEnvelope(
          'BACKOFFICE.MISSING_IDEMPOTENCY_KEY',
          'The Idempotency-Key header is required on every mutating endpoint.',
          'Send a unique Idempotency-Key; replays within 24h return the original token.',
          DOCS_BASE
        ),
        400
      )
    }
    const cacheKey = `care-mint|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await handler(c, params)
    if (res.status >= 200 && res.status < 300) {
      await idempotency.set(cacheKey, res.status, await res.clone().json())
    }
    return res
  }

  return { 'post /care-surface:mint-token': withIdempotency }
}
