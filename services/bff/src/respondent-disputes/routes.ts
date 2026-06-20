import type { Context } from 'hono'
import { RespondentDisputeError, RespondentDisputeService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied, domainError } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-75 — respondent-side Nebras dispute scheme clocks. POST register +
 * POST :advance are mutating (Idempotency-Key required). finance:disputes:write is
 * enforced first by the BFF middleware; the service re-checks it (defence in depth).
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof RespondentDisputeError) return domainError(c, e, 'See the respondent-dispute contract (BACKOFFICE-75).')
  throw e
}

export function respondentDisputeRoutes(service: RespondentDisputeService, idempotency: IdempotencyStore): Record<string, Handler> {
  /** Mutating-route wrapper: Idempotency-Key required, successful 2xx replays verbatim (24h). */
  const withIdempotency = (routeKey: string, handler: Handler): Handler =>
    replayable(idempotency, (params, subject, key) => `${routeKey}|${params.respondent_dispute_id ?? ''}|${subject}|${key}`, handler)

  const registerHandler: Handler = async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send a RespondentDisputeCreate body.', DOCS_BASE), 400)
    }
    try {
      const record = await service.register(c.get('principal'), body, trace(c))
      return c.json(dataEnvelope(record), 201)
    } catch (e) {
      return fail(c, e)
    }
  }

  const advanceHandler: Handler = async (c, params) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { action, note, verdict_outcome? }.', DOCS_BASE), 400)
    }
    try {
      const record = await service.advance(c.get('principal'), params.respondent_dispute_id!, body, trace(c))
      return c.json(dataEnvelope(record), 200)
    } catch (e) {
      return fail(c, e)
    }
  }

  return {
    'post /back-office/disputes/respondent': withIdempotency('respondent-disputes:register', registerHandler),

    'post /back-office/disputes/respondent/{respondent_dispute_id}:advance': withIdempotency('respondent-disputes:advance', advanceHandler),

    'get /back-office/disputes/respondent': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...limitParam(c.req.query('limit')),
          ...(c.req.query('state') ? { state: c.req.query('state') } : {}),
          ...(c.req.query('breach_status') ? { breach_status: c.req.query('breach_status') } : {})
        })
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/disputes/respondent/{respondent_dispute_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(await service.get(c.get('principal'), params.respondent_dispute_id!)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
