import type { Context } from 'hono'
import { TrustFrameworkError, TrustFrameworkService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied, domainError } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-74 — Trust Framework participant administration. POST register +
 * POST :nominate-replacement are mutating (Idempotency-Key required). platform:operations:read
 * gates list/detail; platform:operations:write gates register/nominate — BFF middleware
 * enforces first, the service re-checks.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof TrustFrameworkError) return domainError(c, e, 'See the Trust Framework participant contract (BACKOFFICE-74).')
  throw e
}

export function trustFrameworkRoutes(service: TrustFrameworkService, idempotency: IdempotencyStore): Record<string, Handler> {
  const withIdempotency = (routeKey: string, handler: Handler): Handler =>
    replayable(idempotency, (params, subject, key) => `${routeKey}|${params.participant_id ?? ''}|${subject}|${key}`, handler)

  const registerHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a TrustFrameworkParticipantCreate body.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.register(c.get('principal'), body, trace(c))), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const nominateHandler: Handler = async (c, params) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { replacement_holder_ref, replacement_display_name, note }.', DOCS_BASE), 400)
    }
    try {
      return c.json(dataEnvelope(await service.nominateReplacement(c.get('principal'), params.participant_id!, body, trace(c))), 200)
    } catch (e) {
      return fail(c, e)
    }
  }

  return {
    'post /back-office/trust-framework/participants': withIdempotency('trust-framework:register', registerHandler),

    'post /back-office/trust-framework/participants/{participant_id}:nominate-replacement': withIdempotency('trust-framework:nominate', nominateHandler),

    'get /back-office/trust-framework/participants': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...limitParam(c.req.query('limit')),
          ...(c.req.query('role') ? { role: c.req.query('role') } : {}),
          ...(c.req.query('status') ? { status: c.req.query('status') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/trust-framework/participants/{participant_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(await service.get(c.get('principal'), params.participant_id!)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
