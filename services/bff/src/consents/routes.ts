import type { Context } from 'hono'
import { ConsentSearchError, ConsentSearchService } from './service.js'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'

/**
 * BACKOFFICE-16 — GET /consents:search-psu. The static `consents:admin` scope is
 * enforced first by the BFF middleware (app.ts); the service re-checks it.
 * Read-only — no Idempotency-Key.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function consentRoutes(service: ConsentSearchService): Record<string, Handler> {
  const fail = (c: Context, e: unknown): Response => {
    if (e instanceof ConsentSearchError) {
      return c.json(
        errorEnvelope(
          e.code,
          e.message,
          'Provide identifier_type (bank_customer_id|iban|emirates_id) and identifier; the call is High-class audited.',
          DOCS_BASE
        ),
        e.status as 400 | 403 | 404
      )
    }
    throw e
  }

  return {
    'get /consents:search-psu': async (c) => {
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      const identifierType = c.req.query('identifier_type') ?? ''
      const identifier = c.req.query('identifier') ?? ''
      try {
        const result = await service.search(c.get('principal'), identifierType, identifier, traceId)
        return c.json(dataEnvelope(result), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    // BACKOFFICE-61 — admin detail of one consent (multi-auth M-of-N visibility).
    'get /consents/{consent_id}:admin': async (c, params) => {
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const view = await service.adminView(c.get('principal'), params.consent_id!, traceId)
        return c.json(dataEnvelope(view), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
