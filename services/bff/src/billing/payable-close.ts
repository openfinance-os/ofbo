import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { GatedOperation } from '../approvals/service.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

/**
 * BILL-16 criterion 2 — four-eyes cost-period close (ADR 0007 D4).
 *
 * A gated PRECONDITION feeding the existing BACKOFFICE-06 monthly sign-off, deliberately not a second
 * close mechanism: composing with the existing approval machinery is the rule, and a parallel close
 * would give the bank two places that both claim to have shut the period.
 *
 * The gate itself is the payable mirror of reconcile-before-invoice. A period carrying an unresolved
 * material break cannot close, which is what makes BILL-15's reconciliation load-bearing rather than
 * advisory — otherwise a disputed line reaches an approved payable and gets paid.
 */

/** Same scope both sides, matching the reconciliation gate: two principals, one capability. */
export const PAYABLE_CLOSE_SCOPE = 'finance:reconciliation:write'
export const PAYABLE_CLOSE_OPERATION = 'billing.tpp_cost.period_close'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export class PayableCloseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation: string
  ) {
    super(message)
    this.name = 'PayableCloseError'
  }
}

export interface OpenPayableBreak {
  lineRef: string
  breakType: string
}

export interface PayableCloseStore {
  openPayableBreaks(period: string): Promise<OpenPayableBreak[]>
  saveClose(
    input: {
      period: string
      initiatedBy: string
      approvedBy: string
      approvalRequestId: string | null
      feedsMonthlySignOff: true
    },
    traceId: string
  ): Promise<{ closeId: string; created: boolean }>
}

export interface PayableApprovalRequester {
  request(
    principal: Principal,
    operationType: string,
    payload: Record<string, unknown>,
    traceId: string
  ): Promise<{ approval_request_id: string; state: string }>
}

export interface PayableCloseDeps {
  store: PayableCloseStore
  approvals: PayableApprovalRequester
  audit: HighClassAuditSink
}

export class PayableCloseService {
  constructor(private readonly deps: PayableCloseDeps) {}

  /**
   * Ask to close the period. Never closes inline — the binding four-eyes rule is `202` +
   * `approval_request`, and the close happens only on a second principal's approval.
   */
  async requestClose(
    principal: Principal | undefined,
    period: string,
    traceId: string
  ): Promise<{ approval_request_id: string; state: string; period: string }> {
    if (!principal) {
      throw new PayableCloseError('BACKOFFICE.UNAUTHENTICATED', 'Authentication required.', 401,
        'Present a valid bearer token from the enterprise identity provider (P2).')
    }
    assertScope(principal, PAYABLE_CLOSE_SCOPE)
    if (!PERIOD.test(period)) {
      throw new PayableCloseError('BACKOFFICE.INVALID_PERIOD', `Period ${period} is not YYYY-MM.`, 400,
        'Supply the cost period as YYYY-MM, e.g. 2026-06.')
    }

    await this.assertNoOpenBreaks(period)
    const approval = await this.deps.approvals.request(principal, PAYABLE_CLOSE_OPERATION, {
      period,
      initiated_by: principal.subject,
      trace_id: traceId
    }, traceId)

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_close_requested',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: PAYABLE_CLOSE_SCOPE,
      request_trace_id: traceId,
      response_status: 202,
      request_body: { period, approval_request_id: approval.approval_request_id }
    })
    return { ...approval, period }
  }

  /**
   * Execute the close. Runs ONLY from the gated operation, on the approver's call.
   *
   * Re-checks breaks, and that is the point rather than belt-and-braces: approval is a separate act up
   * to two business hours later, so a break raised in between must stop the close. Checking only at
   * request time closes the period against state that was true then and is not true now.
   */
  async executeClose(
    period: string,
    initiatedBy: string,
    approver: string,
    approvalRequestId: string | null,
    traceId: string
  ): Promise<{ close_id: string; period: string }> {
    if (!PERIOD.test(period)) {
      throw new PayableCloseError('BACKOFFICE.INVALID_PERIOD', `Period ${period} is not YYYY-MM.`, 400,
        'Supply the cost period as YYYY-MM, e.g. 2026-06.')
    }
    if (initiatedBy && approver === initiatedBy) {
      throw new PayableCloseError(
        'BACKOFFICE.FOUR_EYES_SAME_PRINCIPAL',
        `The close of ${period} was initiated and approved by the same principal, which is one person `
        + 'twice rather than four eyes.',
        409,
        'Have a different finance principal approve the close.'
      )
    }
    await this.assertNoOpenBreaks(period)

    const saved = await this.deps.store.saveClose({
      period,
      initiatedBy,
      approvedBy: approver,
      approvalRequestId,
      // The close is a precondition the BACKOFFICE-06 monthly sign-off consumes, never a sign-off of
      // its own. Recorded on the row so the relationship is data rather than convention.
      feedsMonthlySignOff: true
    }, traceId)

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_period_closed',
      acting_principal: approver,
      acting_persona: 'finance-analyst',
      scope_used: PAYABLE_CLOSE_SCOPE,
      request_trace_id: traceId,
      response_status: 200,
      request_body: {
        period,
        close_id: saved.closeId,
        initiated_by: initiatedBy,
        approved_by: approver,
        approval_request_id: approvalRequestId
      }
    })
    return { close_id: saved.closeId, period }
  }

  private async assertNoOpenBreaks(period: string): Promise<void> {
    const open = await this.deps.store.openPayableBreaks(period)
    if (open.length === 0) return
    const named = open.slice(0, 5).map((entry) => `${entry.lineRef} (${entry.breakType})`).join(', ')
    const more = open.length > 5 ? ` and ${open.length - 5} more` : ''
    throw new PayableCloseError(
      'BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS',
      `Cost period ${period} carries ${open.length} unresolved material payable break(s): ${named}${more}. `
      + 'A disputed line must not reach an approved payable.',
      409,
      'Resolve or escalate each break (GET /back-office/reconciliation/breaks) before closing the period.'
    )
  }
}

/**
 * Register the close as a four-eyes gated operation.
 *
 * Both scopes are `finance:reconciliation:write`: four-eyes is about two PEOPLE holding the same
 * capability, not about a second, higher one. The same-principal refusal lives in `executeClose`
 * rather than here so it holds however the operation is invoked.
 */
export function makePayableCloseOperation(service: PayableCloseService): GatedOperation {
  return {
    initiatorScope: PAYABLE_CLOSE_SCOPE,
    approverScope: PAYABLE_CLOSE_SCOPE,
    async execute(payload, ctx) {
      const period = typeof payload.period === 'string' ? payload.period : ''
      const initiatedBy = typeof payload.initiated_by === 'string' ? payload.initiated_by : ''
      const traceId = typeof payload.trace_id === 'string' ? payload.trace_id : 'unknown'
      const approvalRequestId = typeof payload.approval_request_id === 'string' ? payload.approval_request_id : null
      if (!ctx?.approver) {
        throw new PayableCloseError('BACKOFFICE.FOUR_EYES_NO_APPROVER',
          'The close carries no approving principal.', 409,
          'Approve the request through POST /back-office/approvals/{id}:approve.')
      }
      return service.executeClose(period, initiatedBy, ctx.approver, approvalRequestId, traceId)
    }
  }
}
