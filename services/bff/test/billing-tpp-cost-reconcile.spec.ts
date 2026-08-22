import { fils, type ExpectedTppCostStatement, type ReconcilableDocument } from '@ofbo/billing'
import { describe, expect, it, vi } from 'vitest'
import {
  PayableBreakExpiryAlarm,
  TppCostReconcileError,
  TppCostReconcileService,
  billingQueryFor,
  tppCostReconciliationWire
} from '../src/billing/tpp-cost-reconcile.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-15 — the service around the pure comparison.
 *
 * The comparison itself is tested in @ofbo/billing. What is tested here is what only the service can
 * get wrong: refusing rather than producing a misleading result, deriving the idempotency key from
 * the request instead of generating one, alerting while a break can still be queried, and never
 * settling anything it reconciled.
 */

const PERIOD = '2026-06'

// finance-analyst, not an invented persona. PRD §2 puts TPP-of-record cost management and payable
// disputes in the OF Finance Analyst's remit, and SCOPE_MATRIX gives that persona
// finance:reconciliation:write — so this principal is one the matrix can actually mint. An earlier
// version said 'finance-controller', which appears nowhere in SCOPE_MATRIX; the `as Principal` cast
// let it past the Persona union. Harmless at runtime (mintScopes returns [] for an unknown persona,
// so createAuthMiddleware denies it) but not harmless as evidence: this principal is what the audit
// assertions below pin acting_persona and scope_used against, and the matrix is the document those
// assertions are supposed to be defensible under. The route suite already uses finance-analyst.
const AGENT: Principal = {
  subject: 'demo:finance-analyst@bank',
  persona: 'finance-analyst',
  scopes: ['finance:reconciliation:write'],
  bankId: '11111111-1111-4111-8111-111111111111'
} as Principal

const NO_SCOPE: Principal = { ...AGENT, scopes: ['billing:read'] } as Principal

function statement(): ExpectedTppCostStatement {
  return {
    period: PERIOD,
    tenantId: AGENT.bankId as string,
    currency: 'AED',
    rateCardVersion: '2026.06.02',
    evidence: {
      meterRunId: 'run-1', generatedAt: '2026-07-03T02:00:00.000Z', ratingRunAt: '2026-07-03T01:59:00.000Z',
      pricingEffectiveFrom: '2026-06-02', rateSnapshotHash: 'sha256:x', directorySnapshotId: null
    },
    lines: [{
      costRecipientType: 'nebras', costRecipientId: 'NEBRAS', feeStream: 'hub', feeClass: 'hub.standard',
      productFamily: 'payments', apiFamily: 'payments', customerSegment: 'unclassified',
      units: 1000, events: 1000, vatTreatment: 'exclusive',
      expectedNetMilliFils: fils(2500), vatMilliFils: fils(125), expectedGrossMilliFils: fils(2625),
      eventIds: ['evt-1'], fapiInteractionIds: ['fapi-1']
    }],
    totals: {
      nebrasHubNetMilliFils: fils(2500), underlyingLfiPaymentNetMilliFils: 0,
      underlyingLfiDataNetMilliFils: 0, totalNetMilliFils: fils(2500),
      totalVatMilliFils: fils(125), totalGrossMilliFils: fils(2625)
    }
  }
}

function document(unitPriceMilliFils = fils(2.5), net = fils(2500)): ReconcilableDocument {
  return {
    documentId: 'doc-1', documentType: 'nebras_tax_invoice', issuerId: 'NEBRAS',
    documentReference: 'NEB-1', billingPeriod: PERIOD,
    issuedAt: '2026-07-03T00:00:00.000Z', receivedAt: '2026-07-03T09:00:00.000Z',
    lines: [{
      lineRef: 'SI-1', sourceCategory: 'Payment Initiation', feeClass: 'hub.standard', mapped: true,
      costRecipientType: 'nebras', costRecipientId: 'NEBRAS', units: 1000,
      unitPriceMilliFils, actualNetMilliFils: net, vatMilliFils: Math.round(net * 0.05),
      actualGrossMilliFils: net + Math.round(net * 0.05)
    }]
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  const saved: Array<Record<string, unknown>> = []
  const audited: Array<Record<string, unknown>> = []
  const store = {
    documentPeriod: vi.fn(async () => PERIOD),
    reconcilableDocumentsForPeriod: vi.fn(async () => [document()]),
    latestStatement: vi.fn(async () => ({ id: 'stmt-1', statement: statement() })),
    saveReconciliation: vi.fn(async (input: Record<string, unknown>) => {
      saved.push(input)
      return { reconciliationIds: ['rec-1'], created: true }
    }),
    ...overrides
  }
  const audit = { emit: vi.fn(async (e: Record<string, unknown>) => { audited.push(e) }) }
  const service = new TppCostReconcileService({ store: store as never, audit: audit as never })
  return { service, store, saved, audited }
}

describe('BILL-15 TppCostReconcileService', () => {
  it('reconciles a period and persists the outcome', async () => {
    const { service, saved } = harness()
    const result = await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')

    expect(result.reconciliation.matchedLineCount).toBe(1)
    expect(result.reconciliation.breaks).toEqual([])
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ statementId: 'stmt-1' })
  })

  it('REFUSES when the period has no expected statement, rather than calling everything unexpected', () => {
    // Running anyway would classify every provider line as an unexpected charge — a result that reads
    // as a provider fault when it is a missing projection on our side, and one an operator would
    // reasonably raise a billing query from.
    const { service } = harness({ latestStatement: vi.fn(async () => null) })
    return expect(service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.NO_EXPECTED_STATEMENT', status: 409 })
  })

  it('answers 404 for a document that is not this tenant\'s', async () => {
    const { service } = harness({ documentPeriod: vi.fn(async () => null) })
    await expect(service.reconcile(AGENT, 'doc-other', 'key-1', 'trace-1'))
      .rejects.toMatchObject({ code: 'BACKOFFICE.NOT_FOUND', status: 404 })
  })

  it('refuses a principal without the reconciliation scope', async () => {
    const { service, saved } = harness()
    await expect(service.reconcile(NO_SCOPE, 'doc-1', 'key-1', 'trace-1')).rejects.toThrow()
    expect(saved).toEqual([])
  })

  it('refuses an unauthenticated caller', async () => {
    const { service } = harness()
    await expect(service.reconcile(undefined, 'doc-1', 'key-1', 'trace-1'))
      .rejects.toBeInstanceOf(TppCostReconcileError)
  })

  it('derives the run id from the request so a retry cannot double an INSERT-only ledger', async () => {
    const { service, saved } = harness()
    await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-a')
    await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-b')

    // Same idempotency key, different trace: the same run id, so the store's own conflict clause
    // recognises the replay. Generating one here would write a second copy every retry.
    expect(saved[0]!.reconciliationRunId).toBe(saved[1]!.reconciliationRunId)
    expect(saved[0]!.reconciliationRunId).toContain('key-1')
  })

  it('reconciles the whole PERIOD, not the single document named in the path', async () => {
    // A Nebras invoice reconciles both cost components (IG §10.2), so judging it alone is what would
    // let a charge repeated on an LFI self-invoice be counted twice instead of flagged.
    const { service, store } = harness()
    await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')
    expect(store.reconcilableDocumentsForPeriod).toHaveBeenCalledWith(PERIOD)
  })

  it('emits an audit event naming the scope and the outcome', async () => {
    const { service, audited } = harness()
    await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')
    expect(audited[0]).toMatchObject({
      event_type: 'billing_tpp_cost_reconciled',
      scope_used: 'finance:reconciliation:write',
      acting_principal: AGENT.subject,
      request_trace_id: 'trace-1'
    })
  })

  it('carries a late payment through so an IG §10.17 penalty can be accepted', async () => {
    const penaltyDoc: ReconcilableDocument = {
      ...document(),
      lines: [
        ...document().lines,
        {
          lineRef: 'PEN-1', sourceCategory: 'Late Payment Penalty', feeClass: null, mapped: false,
          costRecipientType: 'nebras', costRecipientId: 'NEBRAS', units: 1,
          unitPriceMilliFils: fils(500), actualNetMilliFils: fils(500), vatMilliFils: fils(25),
          actualGrossMilliFils: fils(525)
        }
      ]
    }
    const { service } = harness({
      reconcilableDocumentsForPeriod: vi.fn(async () => [penaltyDoc])
    })
    const withoutSource = await service.reconcile(AGENT, 'doc-1', 'k', 't')
    expect(withoutSource.reconciliation.penaltyLinesAccepted).toBe(0)

    const store = {
      documentPeriod: vi.fn(async () => PERIOD),
      reconcilableDocumentsForPeriod: vi.fn(async () => [penaltyDoc]),
      latestStatement: vi.fn(async () => ({ id: 'stmt-1', statement: statement() })),
      saveReconciliation: vi.fn(async () => ({ reconciliationIds: ['rec-1'], created: true }))
    }
    const withSource = new TppCostReconcileService({
      store: store as never,
      audit: { emit: vi.fn(async () => undefined) } as never,
      latePayments: { latePaymentsForPeriod: async () => [{ period: PERIOD, occurredAt: '2026-07-15T00:00:00.000Z' }] }
    })
    const accepted = await withSource.reconcile(AGENT, 'doc-1', 'k', 't')
    expect(accepted.reconciliation.penaltyLinesAccepted).toBe(1)
  })
})

describe('BILL-15 payable break expiry alarm (criterion 4)', () => {
  function alarmHarness(open: Array<{ lineRef: string; breakType: string }>, now: string) {
    const tickets: Array<Record<string, unknown>> = []
    const alarm = new PayableBreakExpiryAlarm({
      store: { openPayableBreaks: async () => open },
      itsm: {
        createTicket: async (t: Record<string, unknown>) => {
          tickets.push(t)
          return { ticket_id: 'INC-1' }
        }
      } as never,
      audit: { emit: async () => undefined } as never,
      now: () => new Date(now)
    })
    return { alarm, tickets }
  }

  it('stays quiet when nothing is open, however close the deadline', async () => {
    const { alarm, tickets } = alarmHarness([], '2026-08-01T00:00:00.000Z')
    const result = await alarm.check(PERIOD, '2026-08-02T00:00:00.000Z', 'trace')
    expect(result.status).toBe('clear')
    expect(tickets).toEqual([])
  })

  it('stays quiet while there is still time to raise the query', async () => {
    const { alarm, tickets } = alarmHarness([{ lineRef: 'a', breakType: 'rate_variance' }], '2026-07-05T00:00:00.000Z')
    const result = await alarm.check(PERIOD, '2026-08-02T00:00:00.000Z', 'trace')
    expect(result.status).toBe('not_due')
    expect(tickets).toEqual([])
  })

  it('fires as the window closes, while the break can still be queried', async () => {
    // Not at expiry: a query raised on the last day still has to be assembled, and §10.13 gives
    // Nebras ten days to respond after that. An alarm at expiry reports a right already lost.
    const { alarm, tickets } = alarmHarness([{ lineRef: 'a', breakType: 'rate_variance' }], '2026-07-29T00:00:00.000Z')
    const result = await alarm.check(PERIOD, '2026-08-02T00:00:00.000Z', 'trace')
    expect(result.status).toBe('raised')
    expect(result.daysRemaining).toBeGreaterThan(0)
    expect(tickets[0]).toMatchObject({ type: 'billing.tpp_cost.query_window_closing', team: 'finance-operations' })
  })

  it('escalates severity once the window has actually closed', async () => {
    const { alarm, tickets } = alarmHarness([{ lineRef: 'a', breakType: 'rate_variance' }], '2026-08-10T00:00:00.000Z')
    const result = await alarm.check(PERIOD, '2026-08-02T00:00:00.000Z', 'trace')
    expect(result.daysRemaining).toBeLessThan(0)
    expect(tickets[0]).toMatchObject({ severity: 'high' })
  })
})

describe('BILL-15 wire shape', () => {
  it('renders snake_case fields the contract declares, with the response clocks nested', async () => {
    const { service } = harness()
    const result = await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')
    const wire = tppCostReconciliationWire(result.reconciliation)

    expect(wire).toMatchObject({
      period: PERIOD,
      tolerance_milli_fils: fils(1),
      query_window_days: 30,
      query_window_status: 'open',
      matched_line_count: 1,
      break_count: 0,
      response_clocks: { first_response_minutes: 10, final_response_days: 10, escalation_review_days: 15 }
    })
    // No camelCase leaks through: the envelope convention is snake_case JSON fields.
    expect(Object.keys(wire).every((key) => !/[A-Z]/.test(key))).toBe(true)
  })

  it('publishes amounts that TIE OUT against each other on the wire', async () => {
    // A derived amount must be derived from the ROUNDED operands, not rounded from the domain value —
    // rounding a difference is not the difference of the roundings. An earlier comment on the
    // serialiser denied any relation existed ("independent totals … no tie-out to preserve"), which
    // the domain contradicts: netVariance IS actualTotalNet - expectedTotalNet, and each break's
    // variance IS actual - expected.
    //
    // These are the minimal counterexample, at the scale the endpoint actually works at: the default
    // tolerance is ONE FIL, so sub-fil totals are routine rather than exotic.
    //
    //   milli-fils  expected 2500  actual 3000  variance 500
    //   rounded     expected    3  actual    3  variance   1   ← 3 - 3 = 0, but 500 rounds to 1
    const { service } = harness()
    const base = (await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')).reconciliation
    const oneBreak = { ...base.breaks[0]!, expectedNetMilliFils: 2500, actualNetMilliFils: 3000, varianceMilliFils: 500 }

    const wire = tppCostReconciliationWire({
      ...base,
      expectedTotalNetMilliFils: 2500,
      actualTotalNetMilliFils: 3000,
      netVarianceMilliFils: 500,
      grossVarianceMilliFils: 500,
      breakCount: 1,
      breaks: [oneBreak]
    }) as {
      expected_total_net: { amount: number }
      actual_total_net: { amount: number }
      net_variance: { amount: number }
      gross_variance: { amount: number }
      breaks: Array<{ expected_net: { amount: number }; actual_net: { amount: number }; variance: { amount: number } }>
    }

    // Both totals round to the same fil; the variance must not then claim a different one.
    expect(wire.expected_total_net.amount).toBe(wire.actual_total_net.amount)
    expect(wire.net_variance.amount)
      .toBe(wire.actual_total_net.amount - wire.expected_total_net.amount)

    const entry = wire.breaks[0]!
    expect(entry.variance.amount).toBe(entry.actual_net.amount - entry.expected_net.amount)

    // "The amount actually in dispute" is the sum of what the breaks beside it publish.
    expect(wire.gross_variance.amount)
      .toBe(wire.breaks.reduce((sum, b) => sum + Math.abs(b.variance.amount), 0))
  })

  it('keeps gross_variance tied across MANY sub-fil breaks, where the drift accumulates', async () => {
    // One break hides the bug at half a fil. Ten do not: summing the milli-fils first and rounding
    // once reads 5 fils against the 10 the array publishes.
    const { service } = harness()
    const base = (await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')).reconciliation
    const breaks = Array.from({ length: 10 }, (_, i) => ({
      ...base.breaks[0]!,
      lineRef: `NEB-1|L-${i}`,
      expectedNetMilliFils: 0,
      actualNetMilliFils: 500,
      varianceMilliFils: 500
    }))

    const wire = tppCostReconciliationWire({
      ...base, breakCount: breaks.length, grossVarianceMilliFils: 5000, breaks
    }) as { gross_variance: { amount: number }; breaks: Array<{ variance: { amount: number } }> }

    expect(wire.breaks.reduce((sum, b) => sum + Math.abs(b.variance.amount), 0)).toBe(10)
    expect(wire.gross_variance.amount).toBe(10)
  })

  it('builds a billing query from a break, refusing once the window has closed', async () => {
    const { service } = harness({
      reconcilableDocumentsForPeriod: vi.fn(async () => [document(fils(3), fils(3000))])
    })
    const result = await service.reconcile(AGENT, 'doc-1', 'key-1', 'trace-1')
    const entry = result.reconciliation.breaks[0]!
    const bundle = billingQueryFor(result.reconciliation, entry, {
      lfiName: 'Adopting Bank PJSC', tppName: 'Adopting Bank PJSC (TPP of record)',
      invoiceNumber: 'NEB-1', interactionId: 'fapi-1', occurredAt: '2026-07-03T00:00:00.000Z'
    })
    expect(bundle.breakType).toBe('rate_variance')
    expect(bundle.responseClocks.finalResponseDays).toBe(10)

    const expired = { ...result.reconciliation, daysRemainingAtIngest: -1 }
    expect(() => billingQueryFor(expired, entry, {
      lfiName: 'a', tppName: 'b', invoiceNumber: 'c', interactionId: 'd', occurredAt: 'e'
    })).toThrow(/window/i)
  })
})
