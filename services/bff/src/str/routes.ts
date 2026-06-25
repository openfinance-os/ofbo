import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { StrDraftService, StrError, toWire, type StrDraftListQuery } from './service.js'
import { toWire as approvalToWire, ApprovalError } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayCached, missingIdempotencyKey, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-63 — STR draft routes (ADR 0022). list/get gate compliance:reports:read;
 * :submit-to-workflow is four-eyes (compliance:reports:generate initiates → 202; a risk:read
 * second-line approves via the approvals path). Enforced at the BFF middleware AND the service.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof StrError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the STR-draft contract (BACKOFFICE-63).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  if (e instanceof ApprovalError) {
    return c.json(errorEnvelope(e.code, e.message, 'STR handoff is four-eyes (a risk:read second-line approves).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function strDraftRoutes(service: StrDraftService, idempotency: IdempotencyStore): Record<string, Handler> {
  const submitHandler: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) return c.json(missingIdempotencyKey(), 400)
    const cacheKey = `str:submit-to-workflow|${params.str_draft_id}|${c.get('principal').subject}|${key}`
    return replayCached(c, idempotency, cacheKey, async () => {
      try {
        const record = await service.submitToWorkflow(c.get('principal'), params.str_draft_id!, trace(c))
        return c.json(dataEnvelope(approvalToWire(record)), 202)
      } catch (e) {
        return fail(c, e)
      }
    })
  }

  return {
    'post /back-office/str-drafts/{str_draft_id}:submit-to-workflow': submitHandler,

    'get /back-office/str-drafts': async (c) => {
      const q: StrDraftListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...limitParam(c.req.query('limit')),
        ...(c.req.query('status') ? { status: c.req.query('status') } : {})
      }
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), q)
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/str-drafts/{str_draft_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.get(c.get('principal'), params.str_draft_id!))), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
