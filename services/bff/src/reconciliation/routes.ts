import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { StoredReconciliationRun, ReconciliationRunListQuery } from '@ofbo/db'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import type { ReconciliationService } from './service.js'

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

function fail(c: Context, e: unknown): Response {
  if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
  throw e
}

export function reconciliationRoutes(service: ReconciliationService): Record<string, Handler> {
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
    }
  }
}
