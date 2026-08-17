import type { FinancialSystemPort, PayableDispatchStatus } from '@ofbo/ports'
import { assertScope } from '../rbac.js'
import type { Principal } from '../auth.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { PAYABLE_CLOSE_SCOPE } from './payable-close.js'

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

export interface PayableDispatchDeps {
  store: PayableDispatchStore
  financialSystem: FinancialSystemPort
  audit: HighClassAuditSink
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
          // The message only; never the downstream payload, which this service does not inspect.
          failure: error instanceof Error ? error.message : 'unknown financial-system failure'
        }
      })
      throw error
    }
  }
}
