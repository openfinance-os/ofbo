import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { StoredTppCounterparty, TppCounterpartyListQuery, BillingRecordListQuery, InvoiceRunListQuery } from '@ofbo/db'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied, domainError } from '../errors.js'
import { ApprovalError, toWire as approvalToWire } from '../approvals/service.js'
import type { IdempotencyStore } from '../idempotency.js'
import { limitParam } from '../pagination.js'
import { TppRegistryError, type TppRegistryService } from './service.js'
import { InvoicingError, type InvoicingService } from './invoicing.js'

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
  const denied = scopeDenied(c, e)
  if (denied) return denied
  if (e instanceof TppRegistryError || e instanceof InvoicingError) return domainError(c, e, 'See the TPP billing contract (BACKOFFICE-71/-72/-73).')
  if (e instanceof ApprovalError) return domainError(c, e, 'An invoice run is four-eyes-gated; a second authorised principal approves before P9 dispatch.')
  throw e
}

export function tppBillingRoutes(service: TppRegistryService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/tpp-counterparties': async (c) => {
      const q: TppCounterpartyListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...limitParam(c.req.query('limit')),
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

/** BACKOFFICE-73 — monthly TPP invoicing routes (ingest → reconcile → four-eyes invoice). */
export function tppInvoicingRoutes(service: InvoicingService, idempotency: IdempotencyStore): Record<string, Handler> {
  const requireKey = (c: Context): string | null => c.req.header('idempotency-key') ?? null
  const missingKey = (c: Context): Response =>
    c.json(errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE), 400)

  return {
    'get /back-office/billing-records': async (c) => {
      const q: BillingRecordListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...limitParam(c.req.query('limit')),
        ...(c.req.query('billing_period') ? { billing_period: c.req.query('billing_period') } : {})
      }
      try {
        const { rows, next_cursor } = await service.listRecordSets(c.get('principal'), q)
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/billing-records': async (c) => {
      const key = requireKey(c)
      if (!key) return missingKey(c)
      const cacheKey = `billing:ingest|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      let billing_period: string | undefined
      let sourceNote: string | undefined
      let bytes: Uint8Array
      try {
        const body = await c.req.parseBody()
        billing_period = typeof body.billing_period === 'string' ? body.billing_period : undefined
        sourceNote = typeof body.source_note === 'string' ? body.source_note : undefined
        const file = body.file
        if (!(file instanceof File)) return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A multipart file field is required.', 'POST multipart/form-data with { file, billing_period }.', DOCS_BASE), 400)
        bytes = new Uint8Array(await file.arrayBuffer())
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A multipart/form-data body with a file is required.', 'Send { file, billing_period, source_note? }.', DOCS_BASE), 400)
      }
      if (!billing_period) return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'billing_period is required.', 'Send { file, billing_period }.', DOCS_BASE), 400)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const rec = await service.ingest(c.get('principal'), { billing_period, ...(sourceNote ? { source_note: sourceNote } : {}), fileBytes: bytes }, traceId)
        const res = c.json(dataEnvelope(rec), 201)
        await idempotency.set(cacheKey, 201, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/billing-records/{record_set_id}:reconcile': async (c, params) => {
      const key = requireKey(c)
      if (!key) return missingKey(c)
      const cacheKey = `billing:reconcile|${params.record_set_id}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const rec = await service.reconcile(c.get('principal'), params.record_set_id!, traceId)
        const res = c.json(dataEnvelope(rec), 202)
        await idempotency.set(cacheKey, 202, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/invoice-runs': async (c) => {
      const q: InvoiceRunListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...limitParam(c.req.query('limit'))
      }
      try {
        const { rows, next_cursor } = await service.listInvoiceRuns(c.get('principal'), q)
        return c.json(dataEnvelope(rows, { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/invoice-runs': async (c) => {
      const key = requireKey(c)
      if (!key) return missingKey(c)
      let body: { billing_period?: string; record_set_id?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { billing_period, record_set_id }.', DOCS_BASE), 400)
      }
      const cacheKey = `billing:invoice-run|${body.record_set_id ?? ''}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const approval = await service.createInvoiceRun(c.get('principal'), { billing_period: body.billing_period ?? '', record_set_id: body.record_set_id ?? '' }, traceId)
        const res = c.json(dataEnvelope(approvalToWire(approval)), 202)
        await idempotency.set(cacheKey, 202, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/invoice-runs/{invoice_run_id}': async (c, params) => {
      try {
        const run = await service.getInvoiceRun(c.get('principal'), params.invoice_run_id!)
        if (!run) return c.json(errorEnvelope('BACKOFFICE.INVOICE_RUN_NOT_FOUND', `No invoice run ${params.invoice_run_id}.`, 'List at GET /back-office/invoice-runs.', DOCS_BASE), 404 as ContentfulStatusCode)
        return c.json(dataEnvelope(run), 200)
      } catch (e) {
        return fail(c, e)
      }
    }
  }
}
