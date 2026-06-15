import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { StoredTppCounterparty, TppCounterpartyListQuery } from '@ofbo/db'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { IdempotencyStore } from '../idempotency.js'
import { TppRegistryError, type TppRegistryService } from './service.js'

/**
 * BACKOFFICE-71 — consuming-TPP registry routes. List/detail are billing:read;
 * the directory sync is platform:operations:write (202, Idempotency-Key).
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

/** Map the stored counterparty to the OpenAPI TppCounterparty wire shape. */
export function toWire(r: StoredTppCounterparty) {
  return {
    organisation_id: r.organisation_id,
    legal_name: r.legal_name,
    registration_number: r.registration_number,
    directory_contacts: r.directory_contacts,
    directory_synced_at: r.directory_synced_at,
    production_status: r.production_status,
    first_traffic_at: r.first_traffic_at,
    registration_state: r.registration_state,
    financial_system_ref: r.financial_system_ref,
    unbilled_traffic: r.unbilled_traffic,
    mtd_fee_accrual: r.mtd_fee_accrual,
    channel: r.channel
  }
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof TppRegistryError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the TPP billing contract (BACKOFFICE-71/-72).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

export function tppBillingRoutes(service: TppRegistryService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/tpp-counterparties': async (c) => {
      const q: TppCounterpartyListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
        ...(c.req.query('production_status') ? { production_status: c.req.query('production_status') } : {}),
        ...(c.req.query('registration_state') ? { registration_state: c.req.query('registration_state') } : {}),
        ...(c.req.query('unbilled_traffic') ? { unbilled_traffic: c.req.query('unbilled_traffic') === 'true' } : {})
      }
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), q)
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/tpp-counterparties/{organisation_id}': async (c, params) => {
      try {
        const row = await service.get(c.get('principal'), params.organisation_id!)
        if (!row) {
          return c.json(errorEnvelope('BACKOFFICE.COUNTERPARTY_NOT_FOUND', `No counterparty ${params.organisation_id}.`, 'List at GET /back-office/tpp-counterparties.', DOCS_BASE), 404 as ContentfulStatusCode)
        }
        return c.json(dataEnvelope(toWire(row)), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/tpp-counterparties:sync-directory': async (c) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
          400
        )
      }
      const cacheKey = `tpp:sync-directory|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const result = await service.syncDirectory(c.get('principal'), traceId)
        const res = c.json(dataEnvelope(result), 202)
        await idempotency.set(cacheKey, 202, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/tpp-counterparties/{organisation_id}:register-financial-system': async (c, params) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
          400
        )
      }
      const cacheKey = `tpp:register-fs|${params.organisation_id}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const row = await service.registerFinancialSystem(c.get('principal'), params.organisation_id!, traceId)
        const res = c.json(dataEnvelope(toWire(row)), 202)
        await idempotency.set(cacheKey, 202, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
