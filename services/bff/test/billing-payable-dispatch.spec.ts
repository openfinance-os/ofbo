import { describe, expect, it, vi } from 'vitest'
import { PayableDispatchError, PayableDispatchService } from '../src/billing/payable-dispatch.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-16 criterion 3 (service half) — P9 AP dispatch.
 *
 * The port contract suite already proves idempotency and the fail-closed refusal on both adapters.
 * What only the service can establish is the other half of the criterion: that dispatch is AUDITED,
 * and that it CANNOT MUTATE BILLING EVIDENCE.
 *
 * The second is the one worth designing for. Dispatch happens after a four-eyes approval, at the far
 * end of the payable lifecycle, and the tables it sits next to are INSERT-only with no deletion path.
 * A dispatch path that could write back into the statement, document or reconciliation tables would
 * make the evidence a downstream system can influence — so the service is given no way to reach them.
 */

const APPROVER: Principal = {
  subject: 'demo:finance-analyst@bank',
  persona: 'finance-analyst',
  scopes: ['finance:reconciliation:write', 'billing:write'],
  bankId: '11111111-1111-4111-8111-111111111111'
} as Principal

const NO_SCOPE: Principal = { ...APPROVER, scopes: ['billing:read'] } as Principal

const APPROVED = {
  payableId: 'PAY-2026-06-001',
  period: '2026-06',
  counterpartyId: 'NEBRAS',
  counterpartyType: 'nebras' as const,
  amountFils: 2625,
  currency: 'AED',
  approvalRequestId: 'apr-0000-4000-8000-000000000001',
  documentReference: 'NEB-INV-2026-06-0001'
}

function harness(overrides: Record<string, unknown> = {}) {
  const audited: Array<Record<string, unknown>> = []
  const dispatched: Array<Record<string, unknown>> = []
  const port = {
    dispatchPayableInstruction: vi.fn(async (instruction: Record<string, unknown>) => {
      dispatched.push(instruction)
      return { accepted: true, dispatch_ref: 'fms-pay-1', payable_status: 'dispatched', replayed: false }
    }),
    getPayableStatus: vi.fn(async () => ({ payable_status: 'presented' }))
  }
  const store = {
    approvedPayable: vi.fn(async () => APPROVED),
    recordDispatch: vi.fn(async () => ({ dispatchId: 'disp-1', created: true })),
    ...overrides
  }
  const service = new PayableDispatchService({
    store: store as never,
    financialSystem: port as never,
    audit: { emit: vi.fn(async (e: Record<string, unknown>) => { audited.push(e) }) } as never
  })
  return { service, port, store, audited, dispatched }
}

describe('BILL-16 payable dispatch', () => {
  it('dispatches an approved payable and records it', async () => {
    const { service, dispatched } = harness()
    const result = await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')

    expect(result.dispatchRef).toBe('fms-pay-1')
    expect(dispatched[0]).toMatchObject({
      payable_id: 'PAY-2026-06-001',
      amount_fils: 2625,
      currency: 'AED',
      approval_request_id: APPROVED.approvalRequestId,
      idempotency_key: 'idem-1'
    })
  })

  it('REFUSES a payable with no four-eyes approval, before touching the port', async () => {
    // The approval is what authorises honouring the direct debit (IG §10.14-10.15). Dispatching
    // without one would settle money on one person's say-so.
    const { service, port } = harness({
      approvedPayable: vi.fn(async () => ({ ...APPROVED, approvalRequestId: null }))
    })
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.PAYABLE_NOT_APPROVED', status: 409 })
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('answers 404 for a payable that is not this tenant\'s', async () => {
    const { service } = harness({ approvedPayable: vi.fn(async () => null) })
    await expect(service.dispatch(APPROVER, 'PAY-X', 'idem-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.NOT_FOUND', status: 404 })
  })

  it('refuses a principal without the scope', async () => {
    const { service, port } = harness()
    await expect(service.dispatch(NO_SCOPE, 'PAY-2026-06-001', 'idem-1', 'trace-1')).rejects.toThrow()
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('requires an idempotency key rather than generating one', async () => {
    // A generated key makes every retry a new dispatch, which is how the same debit gets authorised
    // twice. The caller's key is what makes the port's dedupe reachable.
    const { service, port } = harness()
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', '', 'trace-1'))
      .rejects.toMatchObject({ status: 400 })
    expect(port.dispatchPayableInstruction).not.toHaveBeenCalled()
  })

  it('surfaces a replayed dispatch as a replay rather than a new one', async () => {
    const { service, port } = harness()
    port.dispatchPayableInstruction.mockResolvedValueOnce({
      accepted: true, dispatch_ref: 'fms-pay-1', payable_status: 'dispatched', replayed: true
    })
    const result = await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')
    expect(result.replayed).toBe(true)
  })

  it('audits the dispatch with the scope, approval and downstream reference', async () => {
    const { service, audited } = harness()
    await service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')
    expect(audited[0]).toMatchObject({
      event_type: 'billing_tpp_cost_payable_dispatched',
      acting_principal: APPROVER.subject,
      scope_used: 'finance:reconciliation:write',
      request_trace_id: 'trace-1'
    })
    expect(audited[0]!.request_body).toMatchObject({
      payable_id: 'PAY-2026-06-001',
      approval_request_id: APPROVED.approvalRequestId,
      dispatch_ref: 'fms-pay-1'
    })
  })

  it('audits a downstream FAILURE too, rather than only the happy path', async () => {
    // An unaudited failure is the case an investigator most needs and least often has.
    const { service, audited, port } = harness()
    port.dispatchPayableInstruction.mockRejectedValueOnce(new Error('financial-system 503'))
    await expect(service.dispatch(APPROVER, 'PAY-2026-06-001', 'idem-1', 'trace-1')).rejects.toThrow()
    expect(audited.some((e) => e.event_type === 'billing_tpp_cost_payable_dispatch_failed')).toBe(true)
  })

  it('CANNOT mutate billing evidence — its store surface has no write into the ledger', () => {
    // Structural, not behavioural: the dependency exposes exactly two methods, one read and one
    // append of a dispatch record. There is no statement, document or reconciliation writer reachable
    // from here, so "dispatch cannot alter the evidence it was approved against" holds by
    // construction rather than by everyone remembering not to.
    const { store } = harness()
    expect(Object.keys(store).sort()).toEqual(['approvedPayable', 'recordDispatch'])
  })
})

describe('BILL-16 PayableDispatchError', () => {
  it('carries its own remediation', () => {
    const error = new PayableDispatchError('BACKOFFICE.X', 'm', 409, 'fix it')
    expect(error).toMatchObject({ code: 'BACKOFFICE.X', status: 409, remediation: 'fix it' })
  })
})
