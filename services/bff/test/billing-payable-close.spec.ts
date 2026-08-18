import { describe, expect, it, vi } from 'vitest'
import {
  PAYABLE_CLOSE_OPERATION,
  PayableCloseError,
  PayableCloseService,
  makePayableCloseOperation
} from '../src/billing/payable-close.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-16 criterion 2 — the four-eyes cost-period close.
 *
 * Two properties carry the whole gate, and neither is the happy path:
 *
 * 1. A period with unresolved material breaks cannot be closed. This is the payable mirror of
 *    reconcile-before-invoice, and it is what makes BILL-15's reconciliation load-bearing rather than
 *    advisory — a disputed line must not reach an approved payable.
 * 2. The break check runs AGAIN at execution. Approval is a separate act up to two business hours
 *    later; checking only at request time closes a period against state that was true then and is not
 *    true now.
 */

const PERIOD = '2026-06'

const CONTROLLER: Principal = {
  subject: 'demo:finance-analyst@bank',
  persona: 'finance-analyst',
  scopes: ['finance:reconciliation:write', 'billing:write', 'billing:read'],
  bankId: '11111111-1111-4111-8111-111111111111'
} as Principal

const NO_SCOPE: Principal = { ...CONTROLLER, scopes: ['billing:read'] } as Principal

function harness(openBreaks: Array<{ lineRef: string; breakType: string }> = []) {
  const audited: Array<Record<string, unknown>> = []
  const closed: Array<Record<string, unknown>> = []
  const store = {
    openPayableBreaks: vi.fn(async () => openBreaks),
    saveClose: vi.fn(async (input: Record<string, unknown>) => {
      closed.push(input)
      return { closeId: 'close-1', created: true }
    }),
    closeForPeriod: vi.fn(async () => null)
  }
  const approvals = { request: vi.fn(async () => ({ approval_request_id: 'apr-1', state: 'pending' })) }
  const service = new PayableCloseService({
    store: store as never,
    approvals: approvals as never,
    audit: { emit: vi.fn(async (e: Record<string, unknown>) => { audited.push(e) }) } as never
  })
  return { service, store, approvals, audited, closed }
}

describe('BILL-16 payable close — the break gate', () => {
  it('REFUSES a close while an unresolved material break exists (409)', async () => {
    // The payable mirror of reconcile-before-invoice: a disputed line must not reach an approved
    // payable, so the period carrying it cannot close.
    const { service, approvals } = harness([{ lineRef: 'NEB-1|SI-1', breakType: 'rate_variance' }])

    await expect(service.requestClose(CONTROLLER, PERIOD, 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS', status: 409 })
    // And no approval was created — a refused close must not leave a request someone can approve.
    expect(approvals.request).not.toHaveBeenCalled()
  })

  it('names the blocking breaks so the refusal is actionable', async () => {
    const { service } = harness([
      { lineRef: 'NEB-1|SI-1', breakType: 'rate_variance' },
      { lineRef: 'NEB-1|SI-2', breakType: 'missing_charge' }
    ])
    await expect(service.requestClose(CONTROLLER, PERIOD, 'trace-1'))
      .rejects.toThrow(/rate_variance/)
  })

  it('creates a four-eyes approval when the period is clean — never closing inline', async () => {
    // The binding hard stop: a four-eyes-gated operation returns 202 + approval_request and never
    // executes on the initiator's call.
    const { service, approvals, closed } = harness([])
    const result = await service.requestClose(CONTROLLER, PERIOD, 'trace-1')

    expect(result.approval_request_id).toBe('apr-1')
    expect(approvals.request).toHaveBeenCalledOnce()
    expect(closed).toEqual([])
  })

  it('refuses a principal without the initiator scope', async () => {
    const { service, approvals } = harness([])
    await expect(service.requestClose(NO_SCOPE, PERIOD, 'trace-1')).rejects.toThrow()
    expect(approvals.request).not.toHaveBeenCalled()
  })

  it('rejects a malformed period rather than querying breaks for it', async () => {
    const { service, store } = harness([])
    await expect(service.requestClose(CONTROLLER, '2026-6', 'trace-1'))
      .rejects.toMatchObject({ status: 400 })
    expect(store.openPayableBreaks).not.toHaveBeenCalled()
  })
})

describe('BILL-16 payable close — execution on the second approval', () => {
  it('RE-CHECKS breaks at execution, not just at request', async () => {
    // Approval is a separate act up to two business hours later. A break raised in between must stop
    // the close; checking only at request time would close the period against state that has changed.
    const { service, store } = harness([])
    await service.requestClose(CONTROLLER, PERIOD, 'trace-1')

    store.openPayableBreaks.mockResolvedValueOnce([{ lineRef: 'NEB-1|SI-9', breakType: 'vat_variance' }])
    const operation = makePayableCloseOperation(service)
    await expect(operation.execute(
      { period: PERIOD, trace_id: 'trace-2', initiated_by: CONTROLLER.subject },
      { approver: 'demo:second-analyst@bank', approverPersona: 'finance-analyst' }
    )).rejects.toMatchObject({ code: 'BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS' })
  })

  it('REFUSES a payload with no initiator rather than skipping the four-eyes check', async () => {
    // The guard read `if (initiatedBy && approver === initiatedBy)`, so an ABSENT initiator fell past
    // it entirely and the close proceeded. POST /approvals accepts an arbitrary operation_payload,
    // which makes such a payload reachable rather than theoretical — and the comment on
    // makePayableCloseOperation promises this refusal "holds however the operation is invoked".
    const { service, closed } = harness([])
    const operation = makePayableCloseOperation(service)

    for (const payload of [
      { period: PERIOD, trace_id: 'trace-2' },
      { period: PERIOD, trace_id: 'trace-2', initiated_by: '' },
      { period: PERIOD, trace_id: 'trace-2', initiated_by: '   ' }
    ]) {
      await expect(operation.execute(payload, {
        approver: 'demo:second-analyst@bank', approverPersona: 'finance-analyst'
      }), JSON.stringify(payload)).rejects.toMatchObject({ code: 'BACKOFFICE.FOUR_EYES_NO_INITIATOR' })
    }
    expect(closed).toHaveLength(0)
  })

  it('refuses one human spelled two ways as if they were two people', async () => {
    // A raw === treats `Finance.Controller` and `finance.controller ` as different principals, which
    // is the cheapest way there is to defeat a four-eyes check. Same normalisation BILL-14 applies
    // between uploader and verifier.
    const { service, closed } = harness([])
    const operation = makePayableCloseOperation(service)

    for (const approver of [CONTROLLER.subject, ` ${CONTROLLER.subject.toUpperCase()} `]) {
      await expect(operation.execute(
        { period: PERIOD, trace_id: 'trace-2', initiated_by: CONTROLLER.subject },
        { approver, approverPersona: 'finance-analyst' }
      ), approver).rejects.toMatchObject({ code: 'BACKOFFICE.FOUR_EYES_SAME_PRINCIPAL' })
    }
    expect(closed).toHaveLength(0)
  })

  it('closes on approval and records both principals', async () => {
    const { service, closed } = harness([])
    await service.requestClose(CONTROLLER, PERIOD, 'trace-1')

    const operation = makePayableCloseOperation(service)
    const result = await operation.execute(
      { period: PERIOD, trace_id: 'trace-2', initiated_by: CONTROLLER.subject },
      { approver: 'demo:second-analyst@bank', approverPersona: 'finance-analyst' }
    ) as { close_id: string }

    expect(result.close_id).toBe('close-1')
    expect(closed[0]).toMatchObject({
      period: PERIOD,
      initiatedBy: CONTROLLER.subject,
      approvedBy: 'demo:second-analyst@bank'
    })
  })

  it('refuses to record the approver as the initiator', async () => {
    // Four-eyes means two people. A close whose approver equals its initiator is one person twice.
    const { service } = harness([])
    const operation = makePayableCloseOperation(service)
    await expect(operation.execute(
      { period: PERIOD, trace_id: 't', initiated_by: CONTROLLER.subject },
      { approver: CONTROLLER.subject, approverPersona: 'finance-analyst' }
    )).rejects.toThrow(/same principal|four-eyes/i)
  })

  it('is registered under both finance scopes, matching the reconciliation gate', () => {
    const { service } = harness([])
    const operation = makePayableCloseOperation(service)
    expect(operation.initiatorScope).toBe('finance:reconciliation:write')
    expect(operation.approverScope).toBe('finance:reconciliation:write')
    expect(PAYABLE_CLOSE_OPERATION).toBe('billing.tpp_cost.period_close')
  })
})

describe('BILL-16 payable close — monthly sign-off', () => {
  it('feeds the existing BACKOFFICE-06 sign-off rather than closing in parallel', async () => {
    // The backlog is explicit that cost-period close is a gated PRECONDITION feeding the existing
    // monthly sign-off, not a second close mechanism.
    const { service, closed } = harness([])
    await service.requestClose(CONTROLLER, PERIOD, 'trace-1')
    const operation = makePayableCloseOperation(service)
    await operation.execute({ period: PERIOD, trace_id: 't', initiated_by: CONTROLLER.subject }, {
      approver: 'demo:second@bank', approverPersona: 'finance-analyst'
    })
    expect(closed[0]).toMatchObject({ feedsMonthlySignOff: true })
  })

  it('emits an audit event naming the scope, period and both principals', async () => {
    const { service, audited } = harness([])
    await service.requestClose(CONTROLLER, PERIOD, 'trace-1')
    const operation = makePayableCloseOperation(service)
    await operation.execute({ period: PERIOD, trace_id: 'trace-2', initiated_by: CONTROLLER.subject }, {
      approver: 'demo:second@bank', approverPersona: 'finance-analyst'
    })
    const closeEvent = audited.find((e) => e.event_type === 'billing_tpp_cost_period_closed')
    expect(closeEvent).toMatchObject({
      scope_used: 'finance:reconciliation:write',
      acting_principal: 'demo:second@bank'
    })
    expect((closeEvent!.request_body as Record<string, unknown>).period).toBe(PERIOD)
  })
})

describe('BILL-16 PayableCloseError', () => {
  it('carries its own remediation, like the BILL-15 reconcile errors', () => {
    const error = new PayableCloseError('BACKOFFICE.X', 'message', 409, 'do the thing')
    expect(error.remediation).toBe('do the thing')
    expect(error.status).toBe(409)
  })
})
