import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ApprovalError, ApprovalsService, toWire } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { IdempotencyCache } from '../idempotency.js'

/**
 * Handlers for the 5 approvals contract paths. Scopes here are dynamic in the
 * spec ('(initiator scope)' etc.), so enforcement is request-dependent and
 * lives in the service (per BACKOFFICE-43's deferral rule). Mutating routes
 * require Idempotency-Key (24h replay window).
 */

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

function fail(c: Context, e: unknown): Response {
  if (e instanceof ApprovalError) {
    return c.json(
      errorEnvelope(e.code, e.message, 'See the approvals flow in the contract — four-eyes operations execute only after a second authorised principal approves.', DOCS_BASE),
      e.status
    )
  }
  throw e
}

export function approvalRoutes(service: ApprovalsService, idempotency = new IdempotencyCache()): Record<string, Handler> {
  const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

  /** Binding convention: mutating endpoints require Idempotency-Key; successful
   *  outcomes replay verbatim inside the 24h window (no duplicate side effects). */
  const withIdempotency = (routeKey: string, handler: Handler): Handler => {
    return async (c, params) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
          400
        )
      }
      const cacheKey = `${routeKey}|${c.get('principal').subject}|${key}`
      const cached = idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const res = await handler(c, params)
      if (res.status >= 200 && res.status < 300) {
        idempotency.set(cacheKey, res.status, await res.clone().json())
      }
      return res
    }
  }

  return {
    'post /approvals': withIdempotency('post /approvals', async (c) => {
      let body: { operation_type?: string; operation_payload?: Record<string, unknown> }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { operation_type, operation_payload }.', DOCS_BASE), 400)
      }
      if (!body.operation_type || typeof body.operation_payload !== 'object' || body.operation_payload === null) {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'operation_type and operation_payload are required.', 'Send { operation_type, operation_payload }.', DOCS_BASE), 400)
      }
      try {
        const r = await service.requestApproval(
          c.get('principal'),
          { operation_type: body.operation_type, operation_payload: body.operation_payload },
          trace(c)
        )
        return c.json(dataEnvelope(toWire(r)), 201)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'get /approvals/pending': async (c) => {
      const limitRaw = c.req.query('limit')
      const page = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(limitRaw ? { limit: Number(limitRaw) } : {})
      }
      const { rows, next_cursor } = await service.listPendingFor(c.get('principal'), trace(c), page)
      return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
    },

    'get /approvals/{approval_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.getFor(c.get('principal'), params.approval_id!, trace(c)))), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /approvals/{approval_id}:approve': withIdempotency('approve', async (c, params) => {
      try {
        const r = await service.approve(c.get('principal'), params.approval_id!, trace(c))
        return c.json(dataEnvelope(toWire(r)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'post /approvals/{approval_id}:reject': withIdempotency('reject', async (c, params) => {
      let body: { reject_reason?: string }
      try {
        body = await c.req.json()
      } catch {
        body = {}
      }
      try {
        const r = await service.reject(c.get('principal'), params.approval_id!, body.reject_reason ?? '', trace(c))
        return c.json(dataEnvelope(toWire(r)), 200)
      } catch (e) {
        return fail(c, e)
      }
    })
  }
}
