import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { StoredReconciliationRun, ReconciliationRunListQuery, StoredReconciliationBreak, ReconciliationBreakListQuery } from '@ofbo/db'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { BreakWorkflowError, type ReconciliationService } from './service.js'
import { ApprovalError, toWire as approvalToWire } from '../approvals/service.js'
import type { IdempotencyStore } from '../idempotency.js'

/**
 * BACKOFFICE-01 — reconciliation run read surface. Both routes are
 * reconciliation:read (enforced at the BFF middleware AND re-checked in the
 * service). The wire schema renames the window columns to
 * reconciliation_window_start/end per the OpenAPI ReconciliationRun.
 */
type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

/** Map the stored run to the OpenAPI ReconciliationRun wire shape. */
export function toWire(run: StoredReconciliationRun) {
  return {
    id: run.id,
    run_id: run.run_id,
    run_type: run.run_type,
    status: run.status,
    reconciliation_window_start: run.window_start,
    reconciliation_window_end: run.window_end,
    line_count_total: run.line_count_total,
    line_count_matched: run.line_count_matched,
    line_count_unmatched: run.line_count_unmatched,
    line_count_disputed: run.line_count_disputed,
    failure_reason: run.failure_reason,
    created_at: run.created_at
  }
}

/** Map a stored break to the OpenAPI ReconciliationBreak wire shape. */
export function breakToWire(b: StoredReconciliationBreak) {
  return {
    id: b.id,
    run_id: b.run_id,
    client_id: b.client_id,
    channel: b.channel,
    line_type: b.line_type,
    status: b.status,
    variance_amount: b.variance_amount,
    variance_count: b.variance_count,
    source_a_ref: b.source_a_ref,
    source_b_ref: b.source_b_ref,
    source_c_ref: b.source_c_ref,
    assigned_to: b.assigned_to,
    sla_clock_started_at: b.sla_clock_started_at,
    resolution_outcome: b.resolution_outcome,
    resolution_note: b.resolution_note,
    nebras_dispute_case_id: b.nebras_dispute_case_id,
    reopened_count: b.reopened_count,
    created_at: b.created_at
  }
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  if (e instanceof BreakWorkflowError) {
    return c.json(errorEnvelope(e.code, e.message, 'See the break workflow contract (BACKOFFICE-03/-04).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  if (e instanceof ApprovalError) {
    return c.json(errorEnvelope(e.code, e.message, 'Reopen is four-eyes-gated (a different audit:read principal approves).', DOCS_BASE), e.status as ContentfulStatusCode)
  }
  throw e
}

/** Mutating-route wrapper: Idempotency-Key required, 2xx replays verbatim (24h). */
function withIdempotency(idempotency: IdempotencyStore, routeKey: string, run: (c: Context, params: Record<string, string>) => Promise<Response>): Handler {
  return async (c, params) => {
    const key = c.req.header('idempotency-key')
    if (!key) {
      return c.json(
        errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
        400
      )
    }
    const cacheKey = `${routeKey}|${params.break_id}|${c.get('principal').subject}|${key}`
    const cached = await idempotency.get(cacheKey)
    if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
    const res = await run(c, params)
    if (res.status >= 200 && res.status < 300) await idempotency.set(cacheKey, res.status, await res.clone().json())
    return res
  }
}

export function reconciliationRoutes(service: ReconciliationService, idempotency: IdempotencyStore): Record<string, Handler> {
  return {
    'get /back-office/reconciliation/runs': async (c) => {
      const q: ReconciliationRunListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
        ...(c.req.query('run_type') ? { run_type: c.req.query('run_type') } : {}),
        ...(c.req.query('status') ? { status: c.req.query('status') } : {})
      }
      try {
        const { rows, next_cursor } = await service.list(c.get('principal'), q)
        return c.json(dataEnvelope(rows.map(toWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/reconciliation/runs/{run_id}': async (c, params) => {
      try {
        const run = await service.getRun(c.get('principal'), params.run_id!)
        if (!run) {
          return c.json(
            errorEnvelope('BACKOFFICE.RUN_NOT_FOUND', `No reconciliation run ${params.run_id}.`, 'List runs at GET /back-office/reconciliation/runs.', DOCS_BASE),
            404 as ContentfulStatusCode
          )
        }
        return c.json(dataEnvelope(toWire(run)), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/reconciliation/breaks': async (c) => {
      const q: ReconciliationBreakListQuery = {
        ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
        ...(c.req.query('limit') ? { limit: Number(c.req.query('limit')) } : {}),
        ...(c.req.query('run_id') ? { run_id: c.req.query('run_id') } : {}),
        ...(c.req.query('status') ? { status: c.req.query('status') } : {}),
        ...(c.req.query('line_type') ? { line_type: c.req.query('line_type') } : {}),
        ...(c.req.query('client_id') ? { client_id: c.req.query('client_id') } : {})
      }
      try {
        const { rows, next_cursor } = await service.listBreaks(c.get('principal'), q)
        return c.json(dataEnvelope(rows.map(breakToWire), { next_cursor }), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/reconciliation/breaks/{break_id}/claim': withIdempotency(idempotency, 'reconciliation:claim', async (c, params) => {
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const claimed = await service.claimBreak(c.get('principal'), params.break_id!, traceId)
        return c.json(dataEnvelope(breakToWire(claimed)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'post /back-office/reconciliation/breaks/{break_id}/resolve': withIdempotency(idempotency, 'reconciliation:resolve', async (c, params) => {
      let body: { resolution_outcome?: string; resolution_note?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { resolution_outcome, resolution_note }.', DOCS_BASE), 400)
      }
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const resolved = await service.resolveBreak(c.get('principal'), params.break_id!, body.resolution_outcome ?? '', body.resolution_note ?? '', traceId)
        return c.json(dataEnvelope(breakToWire(resolved)), 200)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'get /back-office/reconciliation/breaks/{break_id}': async (c, params) => {
      try {
        const b = await service.getBreak(c.get('principal'), params.break_id!)
        if (!b) {
          return c.json(
            errorEnvelope('BACKOFFICE.BREAK_NOT_FOUND', `No break ${params.break_id}.`, 'List breaks at GET /back-office/reconciliation/breaks.', DOCS_BASE),
            404 as ContentfulStatusCode
          )
        }
        return c.json(dataEnvelope(breakToWire(b)), 200)
      } catch (e) {
        return fail(c, e)
      }
    },

    'get /back-office/reconciliation/exports:cbuae': async (c) => {
      const periodStart = c.req.query('period_start')
      const periodEnd = c.req.query('period_end')
      if (!periodStart || !periodEnd) {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_QUERY', 'period_start and period_end (YYYY-MM-DD) are required.', 'Pass both query params.', DOCS_BASE), 400)
      }
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const report = await service.generateCbuaeExport(c.get('principal'), periodStart, periodEnd, traceId)
        return c.json(dataEnvelope(report), 202)
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/reconciliation/monthly-signoff': async (c) => {
      const key = c.req.header('idempotency-key')
      if (!key) {
        return c.json(
          errorEnvelope('BACKOFFICE.MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required on every mutating endpoint.', 'Send a unique Idempotency-Key; replays within 24h return the original result.', DOCS_BASE),
          400
        )
      }
      let body: { period?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { period: "YYYY-MM" }.', DOCS_BASE), 400)
      }
      // Scope the replay key by period so a reused key cannot replay a different month's sign-off.
      const cacheKey = `reconciliation:monthly-signoff|${body.period ?? ''}|${c.get('principal').subject}|${key}`
      const cached = await idempotency.get(cacheKey)
      if (cached) return c.json(cached.body, cached.status as ContentfulStatusCode)
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const report = await service.monthlySignoff(c.get('principal'), body.period ?? '', traceId)
        const res = c.json(dataEnvelope(report), 200)
        await idempotency.set(cacheKey, 200, await res.clone().json())
        return res
      } catch (e) {
        return fail(c, e)
      }
    },

    'post /back-office/reconciliation/breaks/{break_id}/escalate-nebras': withIdempotency(idempotency, 'reconciliation:escalate-nebras', async (c, params) => {
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const result = await service.escalateToNebras(c.get('principal'), params.break_id!, traceId)
        return c.json(dataEnvelope(result), 200)
      } catch (e) {
        return fail(c, e)
      }
    }),

    'post /back-office/reconciliation/breaks/{break_id}/reopen': withIdempotency(idempotency, 'reconciliation:reopen', async (c, params) => {
      let body: { justification?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorEnvelope('BACKOFFICE.INVALID_BODY', 'A JSON body is required.', 'Send { justification }.', DOCS_BASE), 400)
      }
      const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
      try {
        const record = await service.initiateReopen(c.get('principal'), params.break_id!, body.justification ?? '', traceId)
        return c.json(dataEnvelope(approvalToWire(record)), 202)
      } catch (e) {
        return fail(c, e)
      }
    })
  }
}
