import {
  buildAccountingBatch,
  buildAccountingClosePack,
  type AccountingBatch,
  type AccountingBatchInput,
  type AccountingClosePack
} from '@ofbo/billing'
import type { FinancialJournalBatch, FinancialSystemPort } from '@ofbo/ports'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../high-class-audit.js'

export interface BillingAccountingDispatchInput {
  batchArtifactId: string
  adapterProfile: 'demo' | 'enterprise'
  traceId: string
  accepted: boolean
  journalBatchRef?: string
  status: 'accepted' | 'rejected' | 'transport_error'
  errorDetail?: string
}

export interface BillingAccountingStore {
  saveBatch(batch: AccountingBatch, closePack: AccountingClosePack, traceId: string): Promise<{ id: string; created: boolean }>
  appendDispatch(input: BillingAccountingDispatchInput): Promise<{ id: string; attemptNo: number }>
  accountingClosePack(period: string): Promise<AccountingClosePack | null>
}

export class InMemoryBillingAccountingStore implements BillingAccountingStore {
  readonly batches: Array<{ id: string; batch: AccountingBatch; closePack: AccountingClosePack; traceId: string }> = []
  readonly dispatches: Array<BillingAccountingDispatchInput & { id: string; attemptNo: number }> = []

  async saveBatch(batch: AccountingBatch, closePack: AccountingClosePack, traceId: string): Promise<{ id: string; created: boolean }> {
    const existing = this.batches.find((item) => item.batch.batchId === batch.batchId)
    if (existing) {
      if (JSON.stringify(existing.batch) !== JSON.stringify(batch) || JSON.stringify(existing.closePack) !== JSON.stringify(closePack)) {
        throw new Error(`conflicting immutable accounting batch ${batch.batchId}`)
      }
      return { id: existing.id, created: false }
    }
    const id = `accounting-${this.batches.length + 1}`
    this.batches.push({ id, batch: structuredClone(batch), closePack: structuredClone(closePack), traceId })
    return { id, created: true }
  }

  async appendDispatch(input: BillingAccountingDispatchInput): Promise<{ id: string; attemptNo: number }> {
    if (!this.batches.some((item) => item.id === input.batchArtifactId)) throw new Error(`unknown accounting batch ${input.batchArtifactId}`)
    const attemptNo = this.dispatches.filter((item) => item.batchArtifactId === input.batchArtifactId).length + 1
    const id = `accounting-dispatch-${this.dispatches.length + 1}`
    this.dispatches.push({ ...structuredClone(input), id, attemptNo })
    return { id, attemptNo }
  }

  async accountingClosePack(period: string): Promise<AccountingClosePack | null> {
    return structuredClone(this.batches.find((item) => item.batch.period === period)?.closePack ?? null)
  }
}

function financialBatch(batch: AccountingBatch): FinancialJournalBatch {
  return {
    batch_id: batch.batchId,
    period: batch.period,
    posting_date: batch.postingDate,
    account_profile_ref: batch.accountProfileRef,
    journals: batch.journals.map((journal) => ({
      journal_id: journal.journalId,
      source_type: journal.sourceType,
      source_id: journal.sourceId,
      lines: journal.lines.map((line) => ({ account: line.account, side: line.side, amount_fils: line.amountFils }))
    }))
  }
}

/** BILL-07 — derive and persist the balanced instruction before asking P9 to execute it. */
export class BillingAccountingService {
  constructor(private readonly deps: {
    store: BillingAccountingStore
    financialSystem: Pick<FinancialSystemPort, 'postJournalInstructions'>
    audit: HighClassAuditSink
  }) {}

  async generateAndDispatch(input: AccountingBatchInput, adapterProfile: 'demo' | 'enterprise', traceId: string): Promise<{
    batch: AccountingBatch
    closePack: AccountingClosePack
    batchArtifactId: string
    accepted: boolean
    journalBatchRef?: string
  }> {
    const batch = buildAccountingBatch(input)
    const closePack = buildAccountingClosePack(batch)
    const artifact = await this.deps.store.saveBatch(batch, closePack, traceId)
    if (artifact.created) {
      await this.deps.audit.emit({
        event_type: 'billing_accounting_batch_generated', acting_principal: 'system:billing-accounting', acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE, request_trace_id: traceId,
        request_body: { batch_id: batch.batchId, period: batch.period, account_profile_ref: batch.accountProfileRef, journal_count: batch.journals.length, debit_fils: batch.debitFils, credit_fils: batch.creditFils },
        response_status: SYSTEM_ACTOR_RESPONSE_STATUS
      })
    }
    try {
      const response = await this.deps.financialSystem.postJournalInstructions(financialBatch(batch), { trace_id: traceId })
      await this.deps.store.appendDispatch({
        batchArtifactId: artifact.id, adapterProfile, traceId, accepted: response.accepted,
        journalBatchRef: response.journal_batch_ref, status: response.accepted ? 'accepted' : 'rejected'
      })
      await this.deps.audit.emit({
        event_type: 'billing_journal_batch_dispatched', acting_principal: 'system:billing-accounting', acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE, request_trace_id: traceId,
        request_body: { batch_id: batch.batchId, journal_batch_ref: response.journal_batch_ref, adapter_profile: adapterProfile, accepted: response.accepted },
        // The sentinel, like its two siblings in this method: a scheduled dispatcher issues no HTTP
        // response, and synthesising one from a port boolean is the fabrication the convention closes.
        // The outcome is not lost — it is carried by `accepted` in the body and by the dispatch row.
        response_status: SYSTEM_ACTOR_RESPONSE_STATUS
      })
      return { batch, closePack, batchArtifactId: artifact.id, accepted: response.accepted, journalBatchRef: response.journal_batch_ref }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await this.deps.store.appendDispatch({ batchArtifactId: artifact.id, adapterProfile, traceId, accepted: false, status: 'transport_error', errorDetail: detail })
      await this.deps.audit.emit({
        event_type: 'billing_journal_batch_dispatch_failed', acting_principal: 'system:billing-accounting', acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE, request_trace_id: traceId,
        request_body: { batch_id: batch.batchId, adapter_profile: adapterProfile, error: detail }, response_status: SYSTEM_ACTOR_RESPONSE_STATUS
      })
      throw error
    }
  }

  async accountingClosePack(period: string): Promise<AccountingClosePack | null> {
    return this.deps.store.accountingClosePack(period)
  }
}
