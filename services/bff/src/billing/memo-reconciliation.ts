import {
  buildExpectedCollectionMemo,
  diffCollectionMemo,
  rateUsage,
  rerateClosedPeriod as replayClosedPeriod,
  toMinorUnitMoney,
  type ClosedPeriodRerating,
  type CollectionMemo,
  type CollectionMemoDiff,
  type ExpectedCollectionMemo,
  type MeteredLine,
  type RateCard
} from '@ofbo/billing'
import type { ReconLineResult, ReconResult } from '../reconciliation/engine.js'
import type { HighClassAuditSink } from '../high-class-audit.js'

export interface BillingMeterRunIdentity {
  id: string
  period: string
  rateCardVersion: string
  inputHash: string
}

export interface StoredExpectedMemo {
  id: string
  meterRunId: string
  meterInputHash: string
  statement: ExpectedCollectionMemo
}

export interface BillingMemoStore {
  latestMeterRun(period: string): Promise<BillingMeterRunIdentity | null>
  meteredLinesForRun(meterRunId: string): Promise<MeteredLine[]>
  saveExpectedMemo(
    input: Omit<StoredExpectedMemo, 'id'>,
    traceId: string
  ): Promise<{ record: StoredExpectedMemo; created: boolean }>
  latestExpectedMemo(period: string): Promise<StoredExpectedMemo | null>
  saveMemoReconciliation(
    input: {
      expectedMemoId: string
      memo: CollectionMemo
      diff: CollectionMemoDiff
      reconciliationRunId: string
    },
    traceId: string
  ): Promise<{ id: string; created: boolean }>
  saveRerating(
    input: { meterRunId: string; replay: ClosedPeriodRerating },
    traceId: string
  ): Promise<{ id: string; created: boolean }>
}

export interface PreparedE1Workflow {
  recordPreparedResult(
    traceId: string,
    input: {
      runId: string
      runType: string
      window: { start: string; end: string }
      result: ReconResult
    }
  ): Promise<{ run: unknown; created: boolean; breaks: unknown[] }>
}

export interface BillingMemoReconciliationDeps {
  store: BillingMemoStore
  workflow: PreparedE1Workflow
  audit: HighClassAuditSink
}

function assertRateCard(run: BillingMeterRunIdentity, card: RateCard): void {
  if (run.rateCardVersion !== card.version) {
    throw new Error(`meter run ${run.id} used ${run.rateCardVersion}, not requested rate card ${card.version}`)
  }
}

function e1LineType(feeClass: string): ReconLineResult['line_type'] {
  return feeClass.startsWith('payment.') ? 'payment_settlement' : 'lfi_access_log'
}

function e1Result(expectedId: string, diff: CollectionMemoDiff): ReconResult {
  const lines: ReconLineResult[] = diff.lines.map((line) => {
    const expected = toMinorUnitMoney(line.expectedMilliFils, 'AED')
    const variance = toMinorUnitMoney(line.varianceMilliFils, 'AED')
    const material = line.materialVariance
    return {
      line_ref: line.lineRef,
      line_type: e1LineType(line.feeClass),
      channel: 'internal_retail',
      client_id: line.tppId,
      classification: material ? 'unmatched' : 'matched',
      expected_fee: expected,
      nebras_fee: { amount: expected.amount + variance.amount, currency: 'AED' },
      variance: material ? variance : null,
      source_a_ref: `memo:${diff.memoReference}:${line.lineRef}`,
      source_b_ref: `expected:${expectedId}:${line.lineRef}`,
      source_c_ref: null,
      reason: material ? `billing_memo_variance:${line.presence}` : null
    }
  })
  return {
    line_count_total: lines.length,
    line_count_matched: lines.filter((line) => line.classification === 'matched').length,
    line_count_unmatched: lines.filter((line) => line.classification === 'unmatched').length,
    line_count_disputed: 0,
    lines
  }
}

function runIdForMemo(memo: CollectionMemo): string {
  const slug = memo.reference.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  if (!slug) throw new TypeError('memo reference must contain at least one letter or number')
  return `billing-memo-${memo.period}-${slug}`
}

export class BillingMemoReconciliationService {
  private readonly store: BillingMemoStore
  private readonly workflow: PreparedE1Workflow
  private readonly audit: HighClassAuditSink

  constructor(deps: BillingMemoReconciliationDeps) {
    this.store = deps.store
    this.workflow = deps.workflow
    this.audit = deps.audit
  }

  async generateExpectedMemo(
    period: string,
    card: RateCard,
    generatedAt: string,
    traceId: string
  ): Promise<{ record: StoredExpectedMemo; created: boolean }> {
    const meterRun = await this.store.latestMeterRun(period)
    if (!meterRun) throw new Error(`no metering run exists for ${period}`)
    assertRateCard(meterRun, card)
    const facts = await this.store.meteredLinesForRun(meterRun.id)
    const statement = buildExpectedCollectionMemo(rateUsage(facts, card, period), generatedAt)
    const saved = await this.store.saveExpectedMemo({
      meterRunId: meterRun.id,
      meterInputHash: meterRun.inputHash,
      statement
    }, traceId)
    if (saved.created) {
      await this.audit.emit({
        event_type: 'billing_expected_memo_generated',
        acting_principal: 'system:billing-rating-engine',
        acting_persona: 'system',
        scope_used: 'billing:rate',
        request_trace_id: traceId,
        request_body: {
          expected_memo_id: saved.record.id,
          period,
          meter_run_id: meterRun.id,
          meter_input_hash: meterRun.inputHash,
          rate_card_version: card.version,
          generated_on_time: statement.generatedOnTime,
          line_count: statement.lines.length,
          total_milli_fils: statement.totalMilliFils
        },
        response_status: 200
      })
    }
    return saved
  }

  async ingestCollectionMemo(
    memo: CollectionMemo,
    thresholdMilliFils: number,
    traceId: string
  ): Promise<{ diff: CollectionMemoDiff; reconciliation: Awaited<ReturnType<PreparedE1Workflow['recordPreparedResult']>> }> {
    const expected = await this.store.latestExpectedMemo(memo.period)
    if (!expected) throw new Error(`no expected Collection Memo exists for ${memo.period}`)
    const diff = diffCollectionMemo(expected.statement, memo, thresholdMilliFils)
    const reconciliationRunId = runIdForMemo(memo)
    const stored = await this.store.saveMemoReconciliation({
      expectedMemoId: expected.id,
      memo,
      diff,
      reconciliationRunId
    }, traceId)
    const reconciliation = await this.workflow.recordPreparedResult(traceId, {
      runId: reconciliationRunId,
      runType: 'billing_collection_memo',
      window: { start: diff.memoIssuedAt, end: diff.memoReceivedAt },
      result: e1Result(expected.id, diff)
    })
    if (stored.created) {
      await this.audit.emit({
        event_type: 'billing_collection_memo_reconciled',
        acting_principal: 'system:billing-rating-engine',
        acting_persona: 'system',
        scope_used: 'billing:reconcile',
        request_trace_id: traceId,
        request_body: {
          memo_diff_id: stored.id,
          memo_reference: memo.reference,
          period: memo.period,
          reconciliation_run_id: reconciliationRunId,
          material_breaks: diff.materialBreaks,
          query_deadline: diff.queryDeadline,
          query_window_status: diff.queryWindowStatus
        },
        response_status: 200
      })
    }
    return { diff, reconciliation }
  }

  async rerateClosedPeriod(
    period: string,
    previousCard: RateCard,
    correctedCard: RateCard,
    correctionReference: string,
    reratedAt: string,
    traceId: string
  ): Promise<{ replay: ClosedPeriodRerating; id: string; created: boolean }> {
    const meterRun = await this.store.latestMeterRun(period)
    if (!meterRun) throw new Error(`no metering run exists for ${period}`)
    assertRateCard(meterRun, previousCard)
    const facts = await this.store.meteredLinesForRun(meterRun.id)
    const replay = replayClosedPeriod(facts, previousCard, correctedCard, period, correctionReference, reratedAt)
    if (!replay.factsUnchanged) throw new Error('rerating mutated immutable metered facts')
    const saved = await this.store.saveRerating({ meterRunId: meterRun.id, replay }, traceId)
    if (saved.created) {
      await this.audit.emit({
        event_type: 'billing_closed_period_rerated',
        acting_principal: 'system:billing-rating-engine',
        acting_persona: 'system',
        scope_used: 'billing:rate',
        request_trace_id: traceId,
        request_body: {
          rerating_id: saved.id,
          period,
          meter_run_id: meterRun.id,
          metered_facts_fingerprint: replay.meteredFactsFingerprint,
          correction_reference: correctionReference,
          previous_rate_card_version: previousCard.version,
          corrected_rate_card_version: correctedCard.version,
          total_delta_milli_fils: replay.totalDeltaMilliFils,
          facts_unchanged: replay.factsUnchanged
        },
        response_status: 200
      })
    }
    return { replay, ...saved }
  }
}
