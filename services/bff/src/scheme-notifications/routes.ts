import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { SchemeNotificationError, SchemeNotificationService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-78 — outbound scheme notifications. POST raise + POST :acknowledge are
 * mutating (Idempotency-Key required). platform:operations:read gates the list;
 * platform:operations:write gates raise/acknowledge — enforced first by the BFF
 * middleware, re-checked in the service.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof SchemeNotificationError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the scheme-notification contract (BACKOFFICE-78).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function schemeNotificationRoutes(service: SchemeNotificationService, idempotency: IdempotencyStore): Record<string, Handler> {
  const withIdempotency = (routeKey: string, handler: Handler): Handler =>
    replayable(idempotency, (params, subject, key) => `${routeKey}|${params.notification_id ?? ''}|${subject}|${key}`, handler)

  const raiseHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a notification body.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.raise(c.get('principal'), body, trace(c))), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const acknowledgeHandler: Handler = async (c, params) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { nebras_ack_reference }.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.acknowledge(c.get('principal'), params.notification_id!, body, trace(c))), 200)
    } catch (e) {
      return fail(c, e)
    }
  }

  return {
    'post /back-office/scheme-notifications': withIdempotency('scheme-notifications:raise', raiseHandler),

    'post /back-office/scheme-notifications/{notification_id}:acknowledge': withIdempotency('scheme-notifications:acknowledge', acknowledgeHandler),

    'get /back-office/scheme-notifications': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...limitParam(c.req.query('limit')),
          ...(c.req.query('status') ? { status: c.req.query('status') } : {}),
          ...(c.req.query('notification_type') ? { notification_type: c.req.query('notification_type') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
