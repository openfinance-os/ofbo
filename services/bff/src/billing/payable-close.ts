import { assertScope } from '../rbac.js'
import { normalisePrincipal, type Principal } from '../auth.js'
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

/**
 * Re-exported, not redefined. This module used to carry its own copy, which is how the codebase
 * ended up with three normalisers and a shared ApprovalsService that had none — see auth.ts.
 */
export { normalisePrincipal }

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
      // PRD §2: stamped on EVERY High-class record produced under platform:superadmin. The field is
      // optional on HighClassAuditEvent, so omitting it is silent — and a superadmin close was
      // indistinguishable from an analyst's on the one record that matters.
      superadmin_marker: principal.scopes.includes('platform:superadmin'),
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
    /** Every field established by ApprovalsService, not by the caller's payload. */
    evidence: {
      initiatedBy: string
      approver: string
      approverPersona: string
      approverIsSuperadmin: boolean
      approvalRequestId: string | null
    },
    traceId: string
  ): Promise<{ close_id: string; period: string }> {
    const { initiatedBy, approver, approverPersona, approverIsSuperadmin, approvalRequestId } = evidence
    if (!PERIOD.test(period)) {
      throw new PayableCloseError('BACKOFFICE.INVALID_PERIOD', `Period ${period} is not YYYY-MM.`, 400,
        'Supply the cost period as YYYY-MM, e.g. 2026-06.')
    }
    // An ABSENT initiator is a refusal, not a skip. The guard used to read
    // `if (initiatedBy && approver === initiatedBy)`, so a payload carrying no `initiated_by` fell
    // straight past the four-eyes check — and `POST /approvals` accepts an arbitrary
    // operation_payload, which makes such a payload reachable rather than hypothetical. The comment
    // on makePayableCloseOperation says this refusal "holds however the operation is invoked"; the
    // short-circuit defeated it for precisely the invocation that omits the field.
    if (!initiatedBy.trim()) {
      throw new PayableCloseError(
        'BACKOFFICE.FOUR_EYES_NO_INITIATOR',
        `The close of ${period} names no initiating principal, so there is nothing for the approver `
        + 'to be different from. Four eyes cannot be evidenced by one name.',
        409,
        // No endpoint path named here on purpose: this story ships no route, and a remediation
        // citing POST /back-office/billing/payable-close sent an operator to a 404. It reaches a
        // human verbatim, so it has to describe the action rather than a URL that does not exist.
        'Re-request the close so the approval records who initiated it.'
      )
    }
    if (normalisePrincipal(approver) === normalisePrincipal(initiatedBy)) {
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
      // Stored NORMALISED, which criterion 5(b) asks for and the decision above already relies on.
      // The decision compared normalised identities; persisting the raw spellings left the stored
      // evidence in a form where the schema's own case-insensitive CHECK is the only thing standing
      // between it and two rows that look like different humans. Evidence a reader has to normalise
      // before trusting is weaker than evidence that arrives comparable — and these two columns are
      // denormalised copies whose whole purpose is to be read back later.
      initiatedBy: normalisePrincipal(initiatedBy),
      approvedBy: normalisePrincipal(approver),
      approvalRequestId,
      // The close is a precondition the BACKOFFICE-06 monthly sign-off consumes, never a sign-off of
      // its own. Recorded on the row so the relationship is data rather than convention.
      feedsMonthlySignOff: true
    }, traceId)

    await this.deps.audit.emit({
      event_type: 'billing_tpp_cost_period_closed',
      acting_principal: approver,
      // The REAL persona. `hasScope` lets platform:superadmin satisfy finance:reconciliation:write,
      // so a hardcoded 'finance-analyst' recorded a superadmin — or any other persona holding the
      // scope — as an analyst, permanently, in a table with no correction path.
      acting_persona: approverPersona,
      scope_used: PAYABLE_CLOSE_SCOPE,
      superadmin_marker: approverIsSuperadmin,
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
      const traceId = typeof payload.trace_id === 'string' ? payload.trace_id : 'unknown'
      if (!ctx?.approver) {
        throw new PayableCloseError('BACKOFFICE.FOUR_EYES_NO_APPROVER',
          'The close carries no approving principal.', 409,
          'Approve the request through POST /back-office/approvals/{id}:approve.')
      }
      // BOTH principals and the approval id now come from the approval RECORD (criterion 5(b)),
      // never from `payload`. `POST /approvals` accepts an arbitrary operation_payload, so a
      // payload-sourced `initiated_by` let a requester name a third party who never initiated
      // anything — the close then persisted and audited four-eyes evidence naming two people, one of
      // whom had nothing to do with the approval. The approval id was worse: `requestClose` CANNOT
      // put it in the payload, because it is minted afterwards, so it was always null and every
      // executed close cited no approval at all.
      return service.executeClose(period, {
        initiatedBy: ctx.initiator,
        approver: ctx.approver,
        approverPersona: ctx.approverPersona,
        approverIsSuperadmin: ctx.approverIsSuperadmin,
        approvalRequestId: ctx.approvalRequestId
      }, traceId)
    }
  }
}
