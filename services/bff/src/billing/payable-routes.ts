import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { PayableCloseError, type PayableCloseService } from './payable-close.js'
import { PayableDispatchError, type PayableDispatchService } from './payable-dispatch.js'
import { PayablePeriodError, type PayablePeriodService } from './payable-period.js'

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

/**
 * BILL-16 — the HTTP surface for the payable close, the AP dispatch and the period read.
 *
 * All three services already refuse for their own reasons and carry a typed error with a code, a
 * status and a remediation written for the human who reads it. This module does not add rules; it
 * translates. Anything it decided here would be a control the tests of those services could not
 * see.
 */

function domainFailure(
  c: Context,
  error: { code: string; message: string; status: number; remediation: string }
): Response {
  return c.json(
    errorEnvelope(error.code, error.message, error.remediation, DOCS_BASE),
    error.status as ContentfulStatusCode
  )
}

export function payableRoutes(
  services: {
    close: PayableCloseService
    dispatch: PayableDispatchService
    period: PayablePeriodService
  },
  idempotency: IdempotencyStore
): Record<string, Handler> {
  return {
    'get /back-office/billing/cost-periods/{period}': async (c, params) => {
      try {
        const view = await services.period.read(c.get('principal'), params.period ?? '')
        return c.json(dataEnvelope(view), 200)
      } catch (error) {
        if (error instanceof PayablePeriodError) return domainFailure(c, error)
        const denied = scopeDenied(c, error)
        if (denied) return denied
        throw error
      }
    },

    'post /back-office/billing/cost-periods/{period}:close': replayable(
      idempotency,
      (params, subject, key) => `billing:tpp-cost-close|${params.period}|${subject}|${key}`,
      async (c, params) => {
        const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
        try {
          const result = await services.close.requestClose(
            c.get('principal'), params.period ?? '', traceId
          )
          // 202 and an approval_request, never an inline close. The gated operation runs on the
          // SECOND principal's approval through POST /back-office/approvals/{id}:approve.
          return c.json(dataEnvelope({
            approval_request_id: result.approval_request_id,
            state: result.state,
            operation_type: 'billing.tpp_cost.period_close'
          }), 202)
        } catch (error) {
          if (error instanceof PayableCloseError) return domainFailure(c, error)
          const denied = scopeDenied(c, error)
          if (denied) return denied
          throw error
        }
      }
    ),

    'post /back-office/billing/payables/{payable_id}:dispatch': replayable(
      idempotency,
      (params, subject, key) => `billing:tpp-cost-dispatch|${params.payable_id}|${subject}|${key}`,
      async (c, params) => {
        const traceId = c.req.header('x-fapi-interaction-id') ?? 'unknown'
        // Read, never defaulted. The service refuses a blank key rather than generating one, because
        // a generated key makes every retry a new dispatch — which is how one debit gets authorised
        // twice. `replayable` has already rejected a missing header before we get here; this keeps
        // the service's own refusal reachable if that ever changes.
        const idempotencyKey = c.req.header('idempotency-key') ?? ''
        try {
          const result = await services.dispatch.dispatch(
            c.get('principal'), params.payable_id ?? '', idempotencyKey, traceId
          )
          return c.json(dataEnvelope({
            payable_id: params.payable_id,
            dispatch_ref: result.dispatchRef,
            dispatch_state: result.dispatchState,
            payable_status: result.status,
            replayed: result.replayed,
            approval_request_id: result.approvalRequestId,
            dispatched_at: result.dispatchedAt
          }), 200)
        } catch (error) {
          if (error instanceof PayableDispatchError) return domainFailure(c, error)
          const denied = scopeDenied(c, error)
          if (denied) return denied
          throw error
        }
      }
    )
  }
}
