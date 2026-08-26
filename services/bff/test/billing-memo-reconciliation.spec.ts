import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  fils,
  type CollectionMemo,
  type ClosedPeriodRerating,
  type MeteredLine,
  type RateCard
} from '@ofbo/billing'
import type { HighClassAuditEvent } from '../src/high-class-audit.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import {
  InMemoryReconciliationBreakStore,
  InMemoryReconciliationLogStore,
  ReconciliationService
} from '../src/reconciliation/service.js'
import {
  BillingMemoReconciliationService,
  type BillingMemoStore,
  type PreparedE1Workflow,
  type StoredExpectedMemo
} from '../src/billing/memo-reconciliation.js'
import { isExpectedMemoGenerationDay, previousUtcMonth } from '../src/billing/pg-memo-reconciliation.js'

const meterLines: MeteredLine[] = [
  {
    eventId: 'evt-payment',
    occurredAt: '2026-06-15T10:00:00.000Z',
    tppId: 'tpp-a',
    traceId: 'trace-payment',
    side: 'receivable',
    feeClass: 'payment.p2p_sme',
    units: 1
  },
  {
    eventId: 'evt-data',
    occurredAt: '2026-06-15T11:00:00.000Z',
    tppId: 'tpp-b',
    traceId: 'trace-data',
    side: 'receivable',
    feeClass: 'data.corporate_page',
    units: 2
  }
]

class MemoryMemoStore implements BillingMemoStore {
  expected: StoredExpectedMemo | null = null
  diff: Parameters<BillingMemoStore['saveMemoReconciliation']>[0] | null = null
  rerating: ClosedPeriodRerating | null = null

  async latestMeterRun(period: string) {
    return { id: 'meter-run-1', period, rateCardVersion: '2026.06.02', inputHash: 'sha256:meter-input' }
  }

  async meteredLinesForRun() {
    return structuredClone(meterLines)
  }

  async saveExpectedMemo(input: Parameters<BillingMemoStore['saveExpectedMemo']>[0]) {
    if (this.expected) return { record: this.expected, created: false }
    this.expected = { id: 'expected-1', ...input }
    return { record: this.expected, created: true }
  }

  async latestExpectedMemo() {
    return this.expected
  }

  async saveMemoReconciliation(input: Parameters<BillingMemoStore['saveMemoReconciliation']>[0]) {
    this.diff = input
    return { id: 'memo-diff-1', created: true }
  }

  async saveRerating(input: Parameters<BillingMemoStore['saveRerating']>[0]) {
    this.rerating = input.replay
    return { id: 'rerating-1', created: true }
  }
}

class CapturingWorkflow implements PreparedE1Workflow {
  input: Parameters<PreparedE1Workflow['recordPreparedResult']>[1] | null = null

  async recordPreparedResult(traceId: string, input: Parameters<PreparedE1Workflow['recordPreparedResult']>[1]) {
    this.input = input
    return { run: { run_id: input.runId }, created: true, breaks: input.result.lines.filter((line) => line.classification === 'unmatched') }
  }
}

class MemoryAudit {
  events: HighClassAuditEvent[] = []
  async emit(event: HighClassAuditEvent) { this.events.push(event) }
}

describe('BILL-03 memo reconciliation orchestration', () => {
  it('selects the closed prior month only on the scheme-aligned 3rd-day run', () => {
    expect(isExpectedMemoGenerationDay(new Date('2026-07-03T01:00:00.000Z'))).toBe(true)
    expect(isExpectedMemoGenerationDay(new Date('2026-07-02T01:00:00.000Z'))).toBe(false)
    expect(previousUtcMonth(new Date('2026-07-03T01:00:00.000Z'))).toBe('2026-06')
    expect(previousUtcMonth(new Date('2026-01-03T01:00:00.000Z'))).toBe('2025-12')
  })

  it('generates and persists the expected memo from one immutable meter run', async () => {
    const store = new MemoryMemoStore()
    const audit = new MemoryAudit()
    const service = new BillingMemoReconciliationService({ store, workflow: new CapturingWorkflow(), audit })

    const result = await service.generateExpectedMemo(
      '2026-06',
      SCHEME_RATE_CARD_2026_06_02,
      '2026-07-03T01:00:00.000Z',
      'trace-expected'
    )

    expect(result).toMatchObject({ created: true, record: {
      meterRunId: 'meter-run-1',
      meterInputHash: 'sha256:meter-input',
      statement: { generatedOnTime: true, totalMilliFils: fils(105) }
    } })
    expect(audit.events).toContainEqual(expect.objectContaining({
      event_type: 'billing_expected_memo_generated',
      request_trace_id: 'trace-expected'
    }))
  })

  it('persists the line diff and routes material payment/data variances into standard E1', async () => {
    const store = new MemoryMemoStore()
    const workflow = new CapturingWorkflow()
    const service = new BillingMemoReconciliationService({ store, workflow, audit: new MemoryAudit() })
    await service.generateExpectedMemo('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T01:00:00.000Z', 'trace-expected')
    const memo: CollectionMemo = {
      reference: 'CM-2026-06-001',
      period: '2026-06',
      issuedAt: '2026-07-05T00:00:00.000Z',
      receivedAt: '2026-07-05T08:00:00.000Z',
      lines: [
        { tppId: 'tpp-a', feeClass: 'payment.p2p_sme', units: 1, amountMilliFils: fils(28) },
        { tppId: 'tpp-b', feeClass: 'data.corporate_page', units: 2, amountMilliFils: fils(80) }
      ]
    }

    const result = await service.ingestCollectionMemo(memo, fils(1), 'trace-memo')

    expect(result.diff).toMatchObject({ materialBreaks: 1, queryWindowStatus: 'open' })
    expect(store.diff).toMatchObject({
      expectedMemoId: 'expected-1',
      reconciliationRunId: 'billing-memo-2026-06-cm-2026-06-001'
    })
    expect(workflow.input).toMatchObject({
      runId: 'billing-memo-2026-06-cm-2026-06-001',
      runType: 'billing_collection_memo',
      result: { line_count_total: 2, line_count_matched: 1, line_count_unmatched: 1 }
    })
    expect(workflow.input?.result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        line_type: 'payment_settlement',
        classification: 'unmatched',
        variance: { amount: 3, currency: 'AED' },
        source_a_ref: expect.stringContaining('memo:CM-2026-06-001'),
        source_b_ref: expect.stringContaining('expected:expected-1')
      }),
      expect.objectContaining({
        line_type: 'lfi_access_log',
        classification: 'matched'
      })
    ]))
  })

  it('persists a corrected replay against the same meter-run identity', async () => {
    const store = new MemoryMemoStore()
    const audit = new MemoryAudit()
    const service = new BillingMemoReconciliationService({ store, workflow: new CapturingWorkflow(), audit })
    const corrected = structuredClone(SCHEME_RATE_CARD_2026_06_02) as RateCard
    corrected.version = '2026.08.12-correction'
    corrected.receivable['data.corporate_page'].flatMilliFils = fils(50)

    const result = await service.rerateClosedPeriod(
      '2026-06',
      SCHEME_RATE_CARD_2026_06_02,
      corrected,
      'RATE-REVIEW-42',
      '2026-08-12T09:00:00.000Z',
      'trace-rerate'
    )

    expect(result.replay).toMatchObject({ factsUnchanged: true, totalDeltaMilliFils: fils(20) })
    expect(store.rerating).toMatchObject({ correctionReference: 'RATE-REVIEW-42' })
    expect(audit.events).toContainEqual(expect.objectContaining({ event_type: 'billing_closed_period_rerated' }))
  })

  it('creates a claimable standard E1 break through the real reconciliation workflow', async () => {
    const memoStore = new MemoryMemoStore()
    const breakStore = new InMemoryReconciliationBreakStore()
    const workflow = new ReconciliationService({
      store: new InMemoryReconciliationLogStore(),
      breakStore,
      audit: new InMemoryHighClassAuditSink()
    })
    const service = new BillingMemoReconciliationService({
      store: memoStore,
      workflow,
      audit: new InMemoryHighClassAuditSink()
    })
    await service.generateExpectedMemo('2026-06', SCHEME_RATE_CARD_2026_06_02, '2026-07-03T01:00:00.000Z', 'trace-expected')

    const result = await service.ingestCollectionMemo({
      reference: 'CM-E1-001',
      period: '2026-06',
      issuedAt: '2026-07-05T00:00:00.000Z',
      receivedAt: '2026-07-05T08:00:00.000Z',
      lines: [
        { tppId: 'tpp-a', feeClass: 'payment.p2p_sme', units: 1, amountMilliFils: fils(28) },
        { tppId: 'tpp-b', feeClass: 'data.corporate_page', units: 2, amountMilliFils: fils(80) }
      ]
    }, fils(1), 'trace-real-e1')

    expect(result.reconciliation.breaks).toHaveLength(1)
    expect(await breakStore.countForRun('billing-memo-2026-06-cm-e1-001')).toBe(1)
    expect(result.reconciliation.breaks[0]).toMatchObject({
      status: 'flagged',
      line_type: 'payment_settlement',
      variance_amount: { amount: 3, currency: 'AED' },
      client_id: 'tpp-a'
    })
  })
})
