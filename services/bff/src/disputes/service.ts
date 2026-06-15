import type { NebrasEgressPort } from '@ofbo/ports'
import type { DisputeCreateInput, DisputeListQuery, DisputePage, StoredDisputeRecord } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { endOfNextBusinessDay } from '../business-hours.js'
import type { HighClassAuditSink } from '../high-class-audit.js'
import type { ApprovalRecord, GatedOperation } from '../approvals/service.js'
import type { PaymentAdminView, PaymentSource } from './payments.js'

export interface Money {
  amount: number
  currency: string
}

/** The four-eyes refund operation type registered with the approvals service. */
export const REFUND_OPERATION = 'disputes.initiate_refund'

export interface ApprovalRequester {
  requestApproval(
    principal: Principal,
    input: { operation_type: string; operation_payload: Record<string, unknown> },
    traceId: string
  ): Promise<ApprovalRecord>
}

/**
 * BACKOFFICE-20 — unauthorised-payment investigation. The payment admin view is
 * read-only over existing services; dispute creation persists to dispute_case,
 * links a Nebras Case & Dispute Management case via the P6 egress port, and
 * writes one High-class audit event. disputes:admin is enforced at the BFF
 * middleware and re-checked here (defence in depth).
 */

export const DISPUTE_SCOPE = 'disputes:admin'
export const VALID_DISPUTE_TYPES = [
  'unauthorised_payment',
  'unrecognised_tpp',
  'consent_complaint',
  'data_misuse_complaint',
  'other'
] as const

export class DisputeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface DisputeStore {
  create(input: DisputeCreateInput, traceId: string): Promise<StoredDisputeRecord>
  get(id: string): Promise<StoredDisputeRecord | null>
  list(query: DisputeListQuery): Promise<DisputePage>
  markRefundInitiated(id: string, refundAmount: Money, refundRequiredBy: string, traceId: string): Promise<StoredDisputeRecord | null>
}

/** No-database default (tests / local dev). Not isolate-safe — the worker uses
 *  the durable PgDisputeStore. */
export class InMemoryDisputeStore implements DisputeStore {
  private readonly rows: StoredDisputeRecord[] = []
  async create(input: DisputeCreateInput): Promise<StoredDisputeRecord> {
    const now = new Date().toISOString()
    const record: StoredDisputeRecord = {
      id: crypto.randomUUID(),
      psu_identifier: input.psu_identifier,
      dispute_type: input.dispute_type,
      state: 'open',
      originating_payment_id: input.originating_payment_id ?? null,
      originating_consent_id: input.originating_consent_id ?? null,
      originating_call_id: input.originating_call_id ?? null,
      dispute_reason_code: input.dispute_reason_code ?? null,
      sla_clock_started_at: now,
      refund_required_by: null,
      refund_initiated_at: null,
      refund_amount: null,
      nebras_case_id: input.nebras_case_id ?? null,
      care_case_id: null,
      assigned_to: null,
      created_at: now
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredDisputeRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: DisputeListQuery): Promise<DisputePage> {
    let rows = this.rows
    if (query.state) rows = rows.filter((r) => r.state === query.state)
    if (query.psu_identifier) rows = rows.filter((r) => r.psu_identifier === query.psu_identifier)
    return { rows, next_cursor: null }
  }
  async markRefundInitiated(id: string, refundAmount: Money, refundRequiredBy: string): Promise<StoredDisputeRecord | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    r.state = 'refund_initiated'
    r.refund_initiated_at = new Date().toISOString()
    r.refund_required_by = refundRequiredBy
    r.refund_amount = refundAmount
    return r
  }
}

/**
 * The four-eyes refund operation (BACKOFFICE-21). Registered with the approvals
 * service; runs ONLY when a second principal approves — moving the dispute to
 * refund_initiated with the next-business-day SLA deadline recorded, and writing
 * a High-class refund_initiated audit. Never executes inline.
 */
export function makeRefundOperation(deps: {
  store: Pick<DisputeStore, 'markRefundInitiated'>
  egress: Pick<NebrasEgressPort, 'dispatchRefund'>
  audit: HighClassAuditSink
  now?: () => Date
}): GatedOperation {
  const now = deps.now ?? (() => new Date())
  return {
    initiatorScope: DISPUTE_SCOPE,
    approverScope: DISPUTE_SCOPE,
    execute: async (payload) => {
      const disputeId = String(payload.dispute_id)
      const refundAmount = payload.refund_amount as Money
      const consentId = String(payload.originating_consent_id ?? '')
      const traceId = String(payload.trace_id ?? 'unknown')
      const initiatedBy = String(payload.initiated_by ?? 'unknown')
      const initiatedByPersona = String(payload.initiated_by_persona ?? 'unknown')

      // BACKOFFICE-62: dispatch via the formal Ozone Connect refund flow through
      // the P6 egress gateway; track the returned IPP status. The dispatch
      // happens only here — on the second principal's approval.
      const { ipp_status } = await deps.egress.dispatchRefund(consentId, refundAmount, { trace_id: traceId })

      const refundRequiredBy = endOfNextBusinessDay(now()).toISOString()
      const updated = await deps.store.markRefundInitiated(disputeId, refundAmount, refundRequiredBy, traceId)
      if (!updated) throw new Error(`dispute ${disputeId} not found at refund execution`)
      await deps.audit.emit({
        event_type: 'refund_initiated',
        acting_principal: initiatedBy,
        acting_persona: initiatedByPersona,
        scope_used: DISPUTE_SCOPE,
        target_dispute_id: disputeId,
        request_trace_id: traceId,
        request_body: { refund_amount: refundAmount, refund_required_by: refundRequiredBy, ipp_status, four_eyes_approved: true },
        response_status: 200
      })
      return {
        dispute_id: disputeId,
        state: updated.state,
        refund_required_by: updated.refund_required_by,
        refund_amount: updated.refund_amount,
        ipp_status,
        refund_dispatched_at: updated.refund_initiated_at
      }
    }
  }
}

export interface DisputeServiceDeps {
  store: DisputeStore
  payments: PaymentSource
  egress: Pick<NebrasEgressPort, 'createDisputeCase'>
  audit: HighClassAuditSink
  approvals: ApprovalRequester
}

/** Payment admin view — the wire shape (omits the internal psu_identifier). */
export type PaymentAdminWire = Omit<PaymentAdminView, 'psu_identifier'>

export class DisputeService {
  constructor(private readonly deps: DisputeServiceDeps) {}

  paymentView(principal: Principal, paymentId: string): PaymentAdminWire {
    assertScope(principal, DISPUTE_SCOPE)
    const view = this.deps.payments.get(paymentId)
    if (!view) throw new DisputeError('BACKOFFICE.PAYMENT_NOT_FOUND', 'No payment matches that id.', 404)
    // Explicit projection — the internal psu_identifier is not part of the wire view.
    return {
      payment_id: view.payment_id,
      ipp_status: view.ipp_status,
      consent_at_time_of_payment: view.consent_at_time_of_payment,
      cop_outcome: view.cop_outcome,
      risk_information_block: view.risk_information_block,
      channel: view.channel
    }
  }

  async create(
    principal: Principal,
    input: {
      psu_identifier?: string
      dispute_type?: string
      originating_payment_id?: string | null
      originating_consent_id?: string | null
      originating_call_id?: string | null
      dispute_reason_code?: string | null
    },
    traceId: string
  ): Promise<StoredDisputeRecord> {
    assertScope(principal, DISPUTE_SCOPE)
    if (!input.psu_identifier || !input.dispute_type) {
      throw new DisputeError('BACKOFFICE.INVALID_BODY', 'psu_identifier and dispute_type are required.', 400)
    }
    if (!(VALID_DISPUTE_TYPES as readonly string[]).includes(input.dispute_type)) {
      throw new DisputeError('BACKOFFICE.INVALID_DISPUTE_TYPE', `dispute_type must be one of: ${VALID_DISPUTE_TYPES.join(', ')}.`, 400)
    }

    // One-click linkage to Nebras Case & Dispute Management via the P6 egress port.
    const { nebras_case_id } = await this.deps.egress.createDisputeCase(
      {
        dispute_type: input.dispute_type,
        psu_identifier: input.psu_identifier,
        originating_payment_id: input.originating_payment_id ?? null
      },
      { trace_id: traceId }
    )

    const record = await this.deps.store.create(
      {
        psu_identifier: input.psu_identifier,
        dispute_type: input.dispute_type,
        originating_payment_id: input.originating_payment_id ?? null,
        originating_consent_id: input.originating_consent_id ?? null,
        originating_call_id: input.originating_call_id ?? null,
        dispute_reason_code: input.dispute_reason_code ?? null,
        nebras_case_id
      },
      traceId
    )

    await this.deps.audit.emit({
      event_type: 'dispute_created',
      acting_principal: principal.subject,
      acting_persona: principal.persona,
      scope_used: DISPUTE_SCOPE,
      target_psu_identifier: input.psu_identifier,
      target_dispute_id: record.id,
      target_consent_id: input.originating_consent_id ?? null,
      request_trace_id: traceId,
      request_body: {
        dispute_type: input.dispute_type,
        dispute_reason_code: input.dispute_reason_code ?? null,
        originating_payment_id: input.originating_payment_id ?? null,
        nebras_case_id
      },
      response_status: 201,
      superadmin_marker: principal.scopes.includes('platform:superadmin')
    })

    return record
  }

  async list(principal: Principal, query: DisputeListQuery): Promise<DisputePage> {
    assertScope(principal, DISPUTE_SCOPE)
    return this.deps.store.list(query)
  }

  /**
   * BACKOFFICE-21 — initiate a next-business-day refund. Four-eyes-gated: creates
   * an approval_request (never executes inline); a second disputes:admin principal
   * approves, which runs the refund operation. 404 if the dispute is unknown.
   */
  async initiateRefund(
    principal: Principal,
    disputeId: string,
    refundAmount: Money,
    traceId: string
  ): Promise<ApprovalRecord> {
    assertScope(principal, DISPUTE_SCOPE)
    const dispute = await this.deps.store.get(disputeId)
    if (!dispute) throw new DisputeError('BACKOFFICE.DISPUTE_NOT_FOUND', 'No dispute matches that id.', 404)
    return this.deps.approvals.requestApproval(
      principal,
      {
        operation_type: REFUND_OPERATION,
        operation_payload: {
          dispute_id: disputeId,
          refund_amount: refundAmount,
          originating_consent_id: dispute.originating_consent_id,
          initiated_by: principal.subject,
          initiated_by_persona: principal.persona,
          trace_id: traceId
        }
      },
      traceId
    )
  }
}
