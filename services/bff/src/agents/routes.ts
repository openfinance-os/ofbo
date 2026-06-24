import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AgentRegistryError, AgentRegistryService, toWire } from './service.js'
import { toWire as approvalToWire, ApprovalError } from '../approvals/service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayCached, missingIdempotencyKey, type IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'

/**
 * BACKOFFICE-60 — agent DCR routes (ADR 0017). :register (four-eyes → 202) and :revoke
 * are mutating (Idempotency-Key required). platform:agents:read gates list/get;
 * platform:agents:write gates register/revoke — enforced first by the BFF middleware,
 * re-checked in the service.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

const trace = (c: Context) => c.req.header('x-fapi-interaction-id') ?? 'unknown'

function fail(c: Context, e: unknown): Response {
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof AgentRegistryError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the agent DCR contract (BACKOFFICE-60).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  if (e instanceof ApprovalError) {
    return c.json(errorEnvelope(e.code, e.message, 'Agent registration is four-eyes-gated (platform:agents:write).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function agentRoutes(service: AgentRegistryService, idempotency: IdempotencyStore): Record<string, Handler> {
  const registerHandler: Handler = async (c) => {
    const key = c.req.header('idempotency-key')
    if (!key) return c.json(missingIdempotencyKey(), 400)
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { persona, display_name }.', DOCS_BASE), 400)
    }
    // Fold the body into the key so reusing an Idempotency-Key with a DIFFERENT persona/name
    // can't silently replay the first agent's approval (consent revoke scopes by id for the
    // same reason). A genuine double-submit (same key + same body) still dedupes.
    const bodyKey = `${String(body.persona ?? '')}|${String(body.display_name ?? '')}`
    const cacheKey = `agents:register|${c.get('principal').subject}|${key}|${bodyKey}`
    return replayCached(c, idempotency, cacheKey, async () => {
      try {
        const record = await service.register(c.get('principal'), body, trace(c))
        return c.json(dataEnvelope(approvalToWire(record)), 202)
      } catch (e) {
        return fail(c, e)
      }
    })
  }

  const revokeHandler: Handler = async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) return c.json(missingIdempotencyKey(), 400)
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { reason }.', DOCS_BASE), 400)
    }
    const cacheKey = `agents:revoke|${params.agent_id}|${c.get('principal').subject}|${key}`
    return replayCached(c, idempotency, cacheKey, async () => {
      try {
        return c.json(dataEnvelope(toWire(await service.revoke(c.get('principal'), params.agent_id!, body, trace(c)))), 200)
      } catch (e) {
        return fail(c, e)
      }
    })
  }

  return {
    'post /back-office/agents:register': registerHandler,
    'post /back-office/agents/{agent_id}:revoke': revokeHandler,

    'get /back-office/agents': async (c) => {
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), {
          ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
          ...limitParam(c.req.query('limit'))
        })
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/agents/{agent_id}': async (c, params) => {
      try {
        return c.json(dataEnvelope(toWire(await service.get(c.get('principal'), params.agent_id!))), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
