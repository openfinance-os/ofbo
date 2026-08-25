import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { PayableWriteError } from '@ofbo/db'

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
      closeForPeriod: vi.fn(async () => null),
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
      closeForPeriod: vi.fn(async () => null),
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
        closeForPeriod: vi.fn(async () => null),
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

describe('BILL-16 payable routes — the refusals the CONTRACT declares', () => {
  it('answers 409 for an ALREADY-CLOSED period instead of minting a second approval', async () => {
    // Before this the request path checked only breaks, so asking to close a closed period returned
    // 202 and sent a second principal to approve an act that had already happened. The store refuses
    // a divergent close at EXECUTION, but that is a different endpoint and up to two hours later.
    const closeStore = {
      openPayableBreaks: vi.fn(async () => []),
      closeForPeriod: vi.fn(async () => ({ closedAt: '2026-07-02T09:00:00.000Z', approvalRequestId: 'apr-1' })),
      saveClose: vi.fn()
    }
    const res = await app({ payableCloseStore: closeStore }).request(
      `/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-closed-1' }) }
    )
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; message: string; remediation: string } }
    expect(body.error.code).toBe('BACKOFFICE.PERIOD_ALREADY_CLOSED')
    expect(body.error.message).toContain('apr-1')
    expect(body.error.remediation).toMatch(/re-rating/i)
    // A closed period is a settled fact: it is refused BEFORE the break query, so an operator is
    // never sent to resolve breaks that could not unblock anything.
    expect(closeStore.openPayableBreaks).not.toHaveBeenCalled()
  })

  it('maps a STORE refusal to its declared status, not an untyped 500', async () => {
    // PayableWriteError was mapped nowhere in the BFF, so every store-layer refusal escaped to
    // app.onError as a 500 and the contract's declared 409 branch was unreachable on the deployed
    // path — both serve.ts and worker.ts wire the real Pg store.
    const res = await app({
      payableDispatchStore: {
        approvedPayable: vi.fn(async () => ({
          payableId: PAYABLE,
          period: PERIOD,
          counterpartyId: 'nebras',
          counterpartyType: 'nebras' as const,
          amountFils: 105_000,
          currency: 'AED',
          approvalRequestId: 'apr-1',
          documentReference: 'NEB-INV-2026-06'
        })),
        recordDispatch: vi.fn(async () => {
          throw new PayableWriteError(
            'BACKOFFICE.ILLEGAL_DISPATCH_TRANSITION',
            'dispatch idem-x is rejected; accepted does not legally follow it. rejected is terminal.',
            'Record only a state that legally follows the one already on file.'
          )
        })
      },
      approvals: {
        store: {
          get: async () => ({
            approval_request_id: 'apr-1',
            operation_type: 'billing.tpp_cost.period_close',
            operation_payload: { period: PERIOD },
            state: 'approved',
            initiator: 'demo:finance-analyst',
            approver: 'demo:platform-super-admin',
            approver_required_scope: 'finance:reconciliation:write',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            approved_at: new Date().toISOString(),
            reject_reason: null
          }),
          create: async () => undefined,
          update: async () => undefined,
          listPending: async () => []
        }
      }
    }).request(`/back-office/billing/payables/${PAYABLE}:dispatch`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-tr-1' }) })

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string; remediation: string } }
    expect(body.error.code).toBe('BACKOFFICE.ILLEGAL_DISPATCH_TRANSITION')
    // The contract REQUIRES remediation on the error envelope; a bare rethrow lost it.
    expect(body.error.remediation).toBeTruthy()
  })

  it('carries expires_at on the 202 so a client can show the two-hour window', async () => {
    const res = await app().request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-exp-1' }) })
    expect(res.status).toBe(202)
    const body = await res.json() as { data: { expires_at?: string } }
    expect(body.data.expires_at).toBeTruthy()
    expect(Date.parse(body.data.expires_at!)).toBeGreaterThan(Date.now())
  })

  it('gives the second approver a non-PII operation summary on the queue', async () => {
    // Approving this authorises money movement — a closed cost period is what lets a payable be
    // dispatched — so a blank summary was the worst case for it, not a cosmetic gap.
    const instance = app()
    await instance.request(`/back-office/billing/cost-periods/${PERIOD}:close`,
      { method: 'POST', headers: headers('finance-analyst', { 'idempotency-key': 'idem-sum-1' }) })
    const pending = await instance.request('/approvals/pending', { headers: headers('platform-super-admin') })
    const body = await pending.json() as {
      data: Array<{ operation_type: string; operation_summary: { descriptor?: string } | null }>
    }
    const close = body.data.find((e) => e.operation_type === 'billing.tpp_cost.period_close')!
    expect(close.operation_summary?.descriptor).toBe(
      `Close TPP cost period ${PERIOD} · authorises payable dispatch`
    )
    // The period is format-validated; nothing else from the payload reaches the summary.
    expect(JSON.stringify(close.operation_summary)).not.toContain('trace')
    expect(JSON.stringify(close.operation_summary)).not.toContain('initiated_by')
  })
})

describe('BILL-16 — money ties out on the wire', () => {
  it('derives gross from the ROUNDED parts, so net + VAT always equals gross', async () => {
    // Three independent half-up divisions break the source row's own CHECK on the wire: 2500 -> 3,
    // 1500 -> 2, 4000 -> 4, and 3 + 2 is not 4. That publishes a contract violation over perfectly
    // good evidence, which is why the repo has toWireMoneyTriple.
    const res = await app({
      payablePeriodStore: {
        periodClose: vi.fn(async () => null),
        openPayableBreaks: vi.fn(async () => []),
        payablesForPeriod: vi.fn(async () => [{
          payableId: PAYABLE,
          period: PERIOD,
          costRecipientType: 'nebras' as const,
          costRecipientId: 'NEBRAS',
          documentReference: 'NEB-INV-2026-06',
          netMilliFils: 2500,
          vatMilliFils: 1500,
          grossMilliFils: 4000,
          dispatchState: null,
          dispatchedAt: null,
          nettedAgainstMilliFils: null
        }])
      }
    }).request(`/back-office/billing/cost-periods/${PERIOD}`, { headers: headers() })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      data: { payables: Array<{ net_amount: { amount: number }; vat_amount: { amount: number }; gross_amount: { amount: number } }> }
    }
    const money = body.data.payables[0]!
    expect(money.net_amount.amount).toBe(3)
    expect(money.vat_amount.amount).toBe(2)
    // 5, not the 4 an independent rounding of 4000 milli-fils would have published.
    expect(money.gross_amount.amount).toBe(5)
    expect(money.gross_amount.amount).toBe(money.net_amount.amount + money.vat_amount.amount)
  })
})
