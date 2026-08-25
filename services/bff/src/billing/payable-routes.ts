import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { dataEnvelope, errorEnvelope, DOCS_BASE } from '../envelope.js'
import { scopeDenied } from '../errors.js'
import { replayable, type IdempotencyStore } from '../idempotency.js'
import { PayableWriteError } from '@ofbo/db'
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

/**
 * The STORE's refusals, answered with the status the contract declares for them.
 *
 * `PayableWriteError` was mapped nowhere in the BFF, so every store-layer refusal — an unknown
 * payable, an illegal dispatch transition, an approval that does not authorise the write — escaped
 * to `app.onError` as an untyped `500`. The contract declares 404 and 409 for exactly those cases,
 * which made both branches unreachable on the deployed path: `serve.ts` and `worker.ts` both wire
 * the real Pg store, so this was not a theoretical gap.
 */
function writeFailure(c: Context, error: PayableWriteError): Response {
  return c.json(
    errorEnvelope(
      error.code,
      error.message,
      error.remediation
        ?? 'Resolve the conflict the message describes and retry with the same Idempotency-Key.',
      DOCS_BASE
    ),
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
        if (error instanceof PayableWriteError) return writeFailure(c, error)
        const denied = scopeDenied(c, error)
        if (denied) return denied
        throw error
      }
    },

    'get /back-office/billing/tpp-cost-export': async (c) => {
      try {
        const pack = await services.period.exportEvidence(
          c.get('principal'),
          c.req.query('period') ?? '',
          c.req.header('x-fapi-interaction-id') ?? 'unknown'
        )
        return c.json(dataEnvelope(pack), 200)
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
          // `expires_at` is carried because a client cannot show the two-business-hour window
          // (PRD §10) without it, and every other four-eyes route returns it.
          return c.json(dataEnvelope({
            approval_request_id: result.approval_request_id,
            state: result.state,
            operation_type: 'billing.tpp_cost.period_close',
            ...(result.expires_at ? { expires_at: result.expires_at } : {})
          }), 202)
        } catch (error) {
          if (error instanceof PayableCloseError) return domainFailure(c, error)
          if (error instanceof PayableWriteError) return writeFailure(c, error)
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
          if (error instanceof PayableWriteError) return writeFailure(c, error)
          const denied = scopeDenied(c, error)
          if (denied) return denied
          throw error
        }
      }
    )
  }
}
