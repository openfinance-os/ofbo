import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'

/**
 * BILL-16 — the HTTP surface for the payable close, the AP dispatch and the period read.
 *
 * Driven through `createApp` rather than by calling the routes factory directly, because the things
 * most worth asserting are the ones the factory does not own: that the generated route table
 * actually matches these paths, that the scope middleware runs before the handler, and that the
 * four-eyes close returns `202` rather than doing anything inline.
 */

const PERIOD = '2026-06'
const PAYABLE = '22222222-2222-4222-8222-222222222222'

function headers(persona = 'finance-analyst', extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer demo-token:${persona}`,
    'x-fapi-interaction-id': 'test-trace-0001',
    ...extra
  }
}

const CLOSED_PERIOD = {
  closeId: 'close-1',
  period: PERIOD,
  initiatedBy: 'demo:finance-analyst@bank',
  approvedBy: 'demo:platform-super-admin@bank',
  approvalRequestId: 'apr-1',
  feedsMonthlySignOff: true,
  closedAt: '2026-07-02T09:00:00.000Z'
}

function app(overrides: Record<string, unknown> = {}) {
  return createApp({
    payablePeriodStore: {
      periodClose: vi.fn(async () => null),
      payablesForPeriod: vi.fn(async () => []),
      openPayableBreaks: vi.fn(async () => [])
    },
    payableCloseStore: {
      openPayableBreaks: vi.fn(async () => []),
      saveClose: vi.fn(async () => ({ closeId: 'close-1', created: true }))
    },
    payableDispatchStore: {
      approvedPayable: vi.fn(async () => null),
      recordDispatch: vi.fn(async () => ({ dispatchId: 'd-1', created: true, dispatchedAt: '2026-07-11T00:00:00.000Z' }))
    },
    ...overrides
  } as never)
}

describe('BILL-16 payable routes — GET cost-period', () => {
  it('reports an OPEN period with no close and no blockers', async () => {
    const res = await app().request(`/back-office/billing/cost-periods/${PERIOD}`, { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Record<string, unknown> }
    expect(body.data.period).toBe(PERIOD)
    expect(body.data.close_state).toBe('open')
    expect(body.data.open_break_count).toBe(0)
    expect(body.data.approval_request_id).toBeNull()
  })

  it('reports BLOCKED, and publishes the variance as Money rather than bare milli-fils', async () => {
    // The CODE-03 ruling: milli-fils is a rating and storage precision only, and everything the
    // contract shows is integer minor units. 2,500 milli-fils is 3 fils half-up, not 2500.
    const res = await app({
      payablePeriodStore: {
        periodClose: vi.fn(async () => null),
        payablesForPeriod: vi.fn(async () => []),
        openPayableBreaks: vi.fn(async () => [{
          lineRef: 'NEB-1|SI-9',
          breakType: 'rate_variance',
          costRecipientType: 'nebras',
          costRecipientId: 'nebras',
          varianceMilliFils: 2500,
          reconciliationBreakId: null
        }])
      }
    }).request(`/back-office/billing/cost-periods/${PERIOD}`, { headers: headers() })

    expect(res.status).toBe(200)
    const body = await res.json() as { data: { close_state: string; blockers: Array<Record<string, unknown>> } }
    expect(body.data.close_state).toBe('blocked')
    expect(body.data.blockers[0]!.variance).toEqual({ amount: 3, currency: 'AED' })
  })

  it('reports CLOSED even when a break was raised after the close', async () => {
    // A close is a fact that happened. Reporting `blocked` here would misrepresent history as a live
    // refusal — the break stays visible in `blockers`, it simply cannot un-close the period.
    const res = await app({
      payablePeriodStore: {
        periodClose: vi.fn(async () => CLOSED_PERIOD),
        payablesForPeriod: vi.fn(async () => []),
        openPayableBreaks: vi.fn(async () => [{
          lineRef: 'NEB-1|SI-9',
          breakType: 'vat_variance',
          costRecipientType: 'nebras',
          costRecipientId: 'nebras',
          varianceMilliFils: 9000,
          reconciliationBreakId: 'brk-1'
        }])
      }
    }).request(`/back-office/billing/cost-periods/${PERIOD}`, { headers: headers() })

    const body = await res.json() as { data: { close_state: string; open_break_count: number; approval_request_id: string } }
    expect(body.data.close_state).toBe('closed')
    expect(body.data.open_break_count).toBe(1)
    expect(body.data.approval_request_id).toBe('apr-1')
  })

  it('refuses a malformed period with 400 rather than querying for it', async () => {
    const periodStore = {
      periodClose: vi.fn(async () => null),
      payablesForPeriod: vi.fn(async () => []),
      openPayableBreaks: vi.fn(async () => [])
    }
    const res = await app({ payablePeriodStore: periodStore })
      .request('/back-office/billing/cost-periods/2026-13', { headers: headers() })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string; remediation: string } }
    expect(body.error.code).toBe('BACKOFFICE.INVALID_PERIOD')
    expect(body.error.remediation).toContain('YYYY-MM')
    expect(periodStore.periodClose).not.toHaveBeenCalled()
  })

  it('denies a persona without billing:read', async () => {
    const res = await app().request(`/back-office/billing/cost-periods/${PERIOD}`,
      { headers: headers('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})

describe('BILL-16 payable routes — POST :close', () => {
  it('returns 202 and an approval_request, NEVER closing inline', async () => {
    const closeStore = {
      openPayableBreaks: vi.fn(async () => []),
      saveClose: vi.fn(async () => ({ closeId: 'close-1', created: true }))
    }
    const res = await app({ payableCloseStore: closeStore }).request(
      `/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-close-1' }) }
    )
    expect(res.status).toBe(202)
    const body = await res.json() as { data: { approval_request_id: string; state: string; operation_type: string } }
    expect(body.data.state).toBe('pending')
    expect(body.data.operation_type).toBe('billing.tpp_cost.period_close')
    expect(body.data.approval_request_id).toBeTruthy()
    // The binding rule: the close executes on the SECOND principal's approval, never on the request.
    expect(closeStore.saveClose).not.toHaveBeenCalled()
  })

  it('refuses with 409 while an unresolved material break exists', async () => {
    const res = await app({
      payableCloseStore: {
        openPayableBreaks: vi.fn(async () => [{ lineRef: 'NEB-1|SI-1', breakType: 'rate_variance' }]),
        saveClose: vi.fn()
      }
    }).request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-close-2' }) })

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BACKOFFICE.UNRESOLVED_PAYABLE_BREAKS')
    expect(body.error.message).toContain('must not reach an approved payable')
  })

  it('requires an Idempotency-Key', async () => {
    const res = await app().request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers() })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_IDEMPOTENCY_KEY')
  })

  it('denies a persona without finance:reconciliation:write', async () => {
    const res = await app().request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('operations-analyst', { 'idempotency-key': 'idem-close-3' }) })
    expect(res.status).toBe(403)
  })
})

describe('BILL-16 payable routes — POST :dispatch', () => {
  it('404s an unknown payable without reaching P9', async () => {
    const store = {
      approvedPayable: vi.fn(async () => null),
      recordDispatch: vi.fn()
    }
    const res = await app({ payableDispatchStore: store }).request(
      `/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-d-1' }) }
    )
    expect(res.status).toBe(404)
    expect(store.recordDispatch).not.toHaveBeenCalled()
  })

  it('refuses 409 when the period has not closed, so nothing authorises the debit', async () => {
    const store = {
      approvedPayable: vi.fn(async () => ({
        payableId: PAYABLE,
        period: PERIOD,
        counterpartyId: 'nebras',
        counterpartyType: 'nebras' as const,
        amountFils: 105_000,
        currency: 'AED',
        // Null because no close row exists — the authority to honour a debit belongs to the period.
        approvalRequestId: null,
        documentReference: 'NEB-INV-2026-06'
      })),
      recordDispatch: vi.fn()
    }
    const res = await app({ payableDispatchStore: store }).request(
      `/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-d-2' }) }
    )
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.PAYABLE_NOT_APPROVED')
    expect(store.recordDispatch).not.toHaveBeenCalled()
  })

  it('requires an Idempotency-Key — a generated one would authorise a second debit on retry', async () => {
    const res = await app().request(`/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers() })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('BACKOFFICE.MISSING_IDEMPOTENCY_KEY')
  })

  it('denies a persona without finance:reconciliation:write', async () => {
    const res = await app().request(`/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers('customer-care-agent', { 'idempotency-key': 'idem-d-3' }) })
    expect(res.status).toBe(403)
  })
})

describe('BILL-16 — the close is registered on the EXISTING four-eyes primitive', () => {
  it('appears on the approvals queue as billing.tpp_cost.period_close', async () => {
    const instance = app()
    const requested = await instance.request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-q-1' }) })
    expect(requested.status).toBe(202)

    // Visible to the SECOND principal, on the same queue every other gated operation uses. That is
    // the point of composing rather than inventing a parallel close mechanism.
    const pending = await instance.request('/approvals/pending',
      { headers: headers('platform-super-admin') })
    expect(pending.status).toBe(200)
    const body = await pending.json() as { data: Array<{ operation_type: string; approver_required_scope: string }> }
    const close = body.data.find((entry) => entry.operation_type === 'billing.tpp_cost.period_close')
    expect(close).toBeDefined()
    expect(close!.approver_required_scope).toBe('finance:reconciliation:write')
  })
})
