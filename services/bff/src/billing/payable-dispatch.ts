import type { FinancialSystemPort, PayableDispatchStatus } from '@ofbo/ports'
import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { PAYABLE_CLOSE_OPERATION, PAYABLE_CLOSE_SCOPE } from './payable-close.js'
import { redactText } from '@ofbo/redaction'

/**
 * BILL-16 criterion 3 (service half) — hand an approved payable to P9.
 *
 * IG v5.0 §10.14–10.15 makes collection a scheme direct-debit PULL, so "dispatch" here authorises
 * HONOURING a debit rather than pushing a payment. That is why the four-eyes approval is a hard
 * precondition: without it, money settles on one person's say-so.
 *
 * The service's store surface is deliberately two methods — one read, one append of a dispatch
 * record. It carries no writer for the statement, document or reconciliation tables, so "dispatch
 * cannot mutate billing evidence" holds by construction rather than by everyone remembering not to.
 * Those tables are INSERT-only with no deletion path; a downstream system able to influence them
 * would make the evidence answerable to the thing it is meant to justify.
 */

export class PayableDispatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation: string
  ) {
    super(message)
    this.name = 'PayableDispatchError'
  }
}

export interface ApprovedPayable {
  payableId: string
  period: string
  counterpartyId: string
  counterpartyType: 'nebras' | 'underlying_lfi'
  amountFils: number
  currency: string
  /** Null until the four-eyes AP approval exists. */
  approvalRequestId: string | null
  documentReference: string
  /** IG §10.16 offset where the counterparty also operates as a TPP. */
  nettedAgainstFils?: number
}

/** Read the payable, append the dispatch. Nothing here can reach the billing evidence tables. */
export interface PayableDispatchStore {
  approvedPayable(payableId: string): Promise<ApprovedPayable | null>
  recordDispatch(
    input: {
      payableId: string
      dispatchRef: string
      status: PayableDispatchStatus
      approvalRequestId: string
      idempotencyKey: string
    },
    traceId: string
  ): Promise<{ dispatchId: string; created: boolean }>
}

/**
 * The cited approval itself, read at dispatch time.
 *
 * Deliberately the narrowest possible surface — one read, no mutation — so dispatch can verify the
 * four-eyes evidence it acts on without gaining any power to create or alter it.
 */
export interface PayableApprovalReader {
  get(approvalRequestId: string): Promise<{
    approval_request_id: string
    operation_type: string
    operation_payload: Record<string, unknown>
    state: string
    initiator: string
    approver: string | null
    expires_at: string
  } | null>
}

export interface PayableDispatchDeps {
  store: PayableDispatchStore
  financialSystem: FinancialSystemPort
  /**
   * REQUIRED. Dispatch authorises honouring a scheme direct debit, and `approvalRequestId` being a
   * non-empty string was the whole of its evidence — a `pending`, `rejected` or `timed_out` id, or
   * one copied from an unrelated approval, all passed. An optional reader would leave the check
   * absent wherever nobody wired it, which is the same defect with a nicer constructor.
   */
  approvals: PayableApprovalReader
  audit: HighClassAuditSink
  /** Injectable for tests; the expiry comparison must not read the wall clock directly. */
  now?: () => Date
}

export interface PayableDispatchOutcome {
  dispatchRef: string
  status: PayableDispatchStatus
  replayed: boolean
}

export class PayableDispatchService {
  constructor(private readonly deps: PayableDispatchDeps) {}

  async dispatch(
    principal: Principal | undefined,
    payableId: string,
    idempotencyKey: string,
    traceId: string
  ): Promise<PayableDispatchOutcome> {
    if (!principal) {
      throw new PayableDispatchError('BACKOFFICE.UNAUTHENTICATED', 'Authentication required.', 401,
        'Present a valid bearer token from the enterprise identity provider (P2).')
    }
    assertScope(principal, PAYABLE_CLOSE_SCOPE)
    if (!idempotencyKey.trim()) {
      // Never generated here. A generated key makes every retry a NEW dispatch, which is exactly how
      // the same direct debit gets authorised twice; the caller's key is what makes the port's dedupe
      // reachable at all.
      throw new PayableDispatchError('BACKOFFICE.IDEMPOTENCY_KEY_REQUIRED',
        'An Idempotency-Key header is required to dispatch a payable.', 400,
        'Send a stable Idempotency-Key; retrying with the same key is safe and will not double-authorise the debit.')
    }

    const payable = await this.deps.store.approvedPayable(payableId)
    if (!payable) {
      throw new PayableDispatchError('BACKOFFICE.NOT_FOUND', `No payable ${payableId} for this tenant.`, 404,
        'Check the payable id against the period close.')
    }
    if (!payable.approvalRequestId?.trim()) {
      throw new PayableDispatchError(
        'BACKOFFICE.PAYABLE_NOT_APPROVED',
        `Payable ${payableId} has no four-eyes AP approval, and that approval is what authorises `
        + 'honouring the scheme direct debit.',
        409,
        'Obtain the four-eyes AP approval before dispatching.'
      )
    }
    await this.assertApprovalAuthorises(payable, payableId)

    try {
      const result = await this.deps.financialSystem.dispatchPayableInstruction({
        payable_id: payable.payableId,
        period: payable.period,
        counterparty_id: payable.counterpartyId,
        counterparty_type: payable.counterpartyType,
        amount_fils: payable.amountFils,
        currency: payable.currency,
        approval_request_id: payable.approvalRequestId,
        document_reference: payable.documentReference,
        ...(payable.nettedAgainstFils === undefined ? {} : { netted_against_fils: payable.nettedAgainstFils }),
        idempotency_key: idempotencyKey
      }, { trace_id: traceId })

      await this.deps.store.recordDispatch({
        payableId: payable.payableId,
        dispatchRef: result.dispatch_ref,
        status: result.payable_status,
        approvalRequestId: payable.approvalRequestId,
        idempotencyKey
      }, traceId)

      await this.deps.audit.emit({
        event_type: 'billing_tpp_cost_payable_dispatched',
        acting_principal: principal.subject,
        acting_persona: principal.persona,
        scope_used: PAYABLE_CLOSE_SCOPE,
        request_trace_id: traceId,
        response_status: 200,
        request_body: {
          payable_id: payable.payableId,
          period: payable.period,
          counterparty_id: payable.counterpartyId,
          amount_fils: payable.amountFils,
          currency: payable.currency,
          approval_request_id: payable.approvalRequestId,
          dispatch_ref: result.dispatch_ref,
          payable_status: result.payable_status,
          replayed: result.replayed
        }
      })
      return { dispatchRef: result.dispatch_ref, status: result.payable_status, replayed: result.replayed }
    } catch (error) {
      // Audited on the way out. A failure here is the case an investigator most needs and least often
      // has — "did we authorise this debit?" must be answerable when the answer is no.
      await this.deps.audit.emit({
        event_type: 'billing_tpp_cost_payable_dispatch_failed',
        acting_principal: principal.subject,
        acting_persona: principal.persona,
        scope_used: PAYABLE_CLOSE_SCOPE,
        request_trace_id: traceId,
        response_status: 502,
        request_body: {
          payable_id: payable.payableId,
          approval_request_id: payable.approvalRequestId,
          idempotency_key: idempotencyKey,
          // Redacted, not merely "the message only". The old comment claimed this service never
          // writes downstream content — but the message is COMPOSED by the P9 adapter from the
          // vendor's response, so the claim held only as long as every adapter chose its wording
          // carefully. One did not. The adapter is fixed at source; this is the second control,
          // because the write is unremovable and P9's response shape is the vendor's to change.
          failure: redactText(error instanceof Error ? error.message : 'unknown financial-system failure')
        }
      })
      throw error
    }
  }
  /**
   * BILL-16 criterion 5(a): the CITED approval must actually authorise THIS payable, right now.
   *
   * A foreign key can constrain existence and tenant. It cannot constrain state, expiry, or subject,
   * because all three are mutable on the referenced row — so the schema was never going to carry
   * this and the write path has to. Presence of a non-empty id was the entire check, which admitted
   * four distinct ways to dispatch money without a live approval:
   *
   *   - a `pending` id, approved by nobody;
   *   - a `rejected` id, approved by somebody who said no;
   *   - a `timed_out` id, whose 2-business-hour window (PRD §10 adopting-bank default) has passed;
   *   - an id copied from an unrelated approval, for a different period entirely.
   *
   * The period binding is what makes the last one detectable: the close operation's payload names the
   * period it closes, and a payable belongs to exactly one period.
   */
  private async assertApprovalAuthorises(
    payable: ApprovedPayable,
    payableId: string
  ): Promise<void> {
    const approvalId = payable.approvalRequestId as string
    const approval = await this.deps.approvals.get(approvalId)
    if (!approval) {
      throw new PayableDispatchError(
        'BACKOFFICE.APPROVAL_NOT_FOUND',
        `Payable ${payableId} cites approval ${approvalId}, which does not exist. A dangling citation `
        + 'is not weaker evidence than a real one — it is none.',
        409,
        'Re-request the four-eyes AP approval for this payable before dispatching.'
      )
    }
    if (approval.operation_type !== PAYABLE_CLOSE_OPERATION) {
      throw new PayableDispatchError(
        'BACKOFFICE.APPROVAL_WRONG_OPERATION',
        `Approval ${approvalId} authorises ${approval.operation_type}, not a payable close. An `
        + 'approval authorises the act it was granted for, not any act that quotes its id.',
        409,
        'Cite the approval granted for this period close.'
      )
    }
    const approvedPeriod = typeof approval.operation_payload.period === 'string'
      ? approval.operation_payload.period
      : null
    if (approvedPeriod !== payable.period) {
      throw new PayableDispatchError(
        'BACKOFFICE.APPROVAL_WRONG_PERIOD',
        `Approval ${approvalId} covers a different period from payable ${payableId}. Without this `
        + 'check an id copied from any approved close would authorise any payable.',
        409,
        'Cite the approval granted for this payable\'s own period close.'
      )
    }
    const now = (this.deps.now ?? (() => new Date()))()
    if (approval.state === 'pending' && now.getTime() > new Date(approval.expires_at).getTime()) {
      // Reported as expired rather than pending: the state column has not been touched since the
      // window closed, and "still pending" would understate what happened.
      throw new PayableDispatchError(
        'BACKOFFICE.APPROVAL_EXPIRED',
        `Approval ${approvalId} timed out at ${approval.expires_at} without being approved `
        + '(2 business hours, PRD §10).',
        409,
        'Re-request the close so a live approval authorises the dispatch.'
      )
    }
    if (approval.state !== 'approved') {
      throw new PayableDispatchError(
        'BACKOFFICE.APPROVAL_NOT_APPROVED',
        `Approval ${approvalId} is ${approval.state}, so nothing has authorised honouring this debit.`,
        409,
        'Have a second finance principal approve the close before dispatching.'
      )
    }
    if (!approval.approver?.trim() || approval.approver === approval.initiator) {
      // Belt and braces on the primitive's own rule. An `approved` row with no approver, or with the
      // initiator as approver, is four eyes on paper and two in fact — and this service is the last
      // place that can refuse before the money moves.
      throw new PayableDispatchError(
        'BACKOFFICE.FOUR_EYES_SAME_PRINCIPAL',
        `Approval ${approvalId} records no second principal, so it evidences one person twice.`,
        409,
        'Have a different finance principal approve the close.'
      )
    }
  }
}
