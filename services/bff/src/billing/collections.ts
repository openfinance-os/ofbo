import {
  decomposeSettlement,
  eligibleCollectionRails,
  evaluateDunning,
  summarizeDsoByTpp,
  type CollectionInvoice,
  type DirectCollectionRail,
  type DunningActionType,
  type DunningEvaluation,
  type DunningPolicy,
  type DunningState,
  type SettlementDecomposition,
  type SettlementInput,
  type TppDsoSummary
} from '@ofbo/billing'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../high-class-audit.js'

export interface DirectCollectionInvoice extends CollectionInvoice {
  eligibleRails: DirectCollectionRail[]
  selectedRail: DirectCollectionRail
  policyRef: string
}

export interface StoredCollectionAction {
  invoiceId: string
  fromState: DunningState
  toState: DunningState
  actionType: 'collection_requested' | Exclude<DunningActionType, 'none'>
  policyRef: string
  occurredAt: string
  traceId: string
}

export interface BillingCollectionsStore {
  saveSettlement(result: SettlementDecomposition, traceId: string): Promise<{ created: boolean }>
  saveCollectionInvoice(invoice: DirectCollectionInvoice, traceId: string): Promise<{ created: boolean }>
  collectionInvoice(invoiceId: string): Promise<DirectCollectionInvoice | null>
  appendCollectionAction(action: StoredCollectionAction): Promise<{ created: boolean }>
  latestCollectionState(invoiceId: string): Promise<DunningState | null>
  listCollectionInvoices(): Promise<DirectCollectionInvoice[]>
  listCollectionActions(): Promise<StoredCollectionAction[]>
  listSettlements(period: string): Promise<SettlementDecomposition[]>
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class InMemoryBillingCollectionsStore implements BillingCollectionsStore {
  readonly settlements: SettlementDecomposition[] = []
  readonly collectionInvoices: DirectCollectionInvoice[] = []
  readonly collectionActions: StoredCollectionAction[] = []

  async saveSettlement(result: SettlementDecomposition): Promise<{ created: boolean }> {
    const existing = this.settlements.find((item) => item.settlementReference === result.settlementReference)
    if (existing) {
      if (!same(existing, result)) throw new Error(`conflicting immutable settlement ${result.settlementReference}`)
      return { created: false }
    }
    this.settlements.push(structuredClone(result))
    return { created: true }
  }

  async saveCollectionInvoice(invoice: DirectCollectionInvoice): Promise<{ created: boolean }> {
    const existing = this.collectionInvoices.find((item) => item.invoiceId === invoice.invoiceId)
    if (existing) {
      if (!same(existing, invoice)) throw new Error(`conflicting immutable collection invoice ${invoice.invoiceId}`)
      return { created: false }
    }
    this.collectionInvoices.push(structuredClone(invoice))
    return { created: true }
  }

  async collectionInvoice(invoiceId: string): Promise<DirectCollectionInvoice | null> {
    return structuredClone(this.collectionInvoices.find((item) => item.invoiceId === invoiceId) ?? null)
  }

  async appendCollectionAction(action: StoredCollectionAction): Promise<{ created: boolean }> {
    const existing = this.collectionActions.find((item) => item.invoiceId === action.invoiceId && item.toState === action.toState)
    if (existing) return { created: false }
    this.collectionActions.push(structuredClone(action))
    return { created: true }
  }

  async latestCollectionState(invoiceId: string): Promise<DunningState | null> {
    return this.collectionActions.filter((action) => action.invoiceId === invoiceId).at(-1)?.toState ?? null
  }

  async listCollectionInvoices(): Promise<DirectCollectionInvoice[]> {
    return structuredClone(this.collectionInvoices)
  }

  async listCollectionActions(): Promise<StoredCollectionAction[]> {
    return structuredClone(this.collectionActions)
  }

  async listSettlements(period: string): Promise<SettlementDecomposition[]> {
    return structuredClone(this.settlements.filter((settlement) => settlement.period === period))
  }
}

export interface CollectionsFinanceSummary {
  openInvoiceCount: number
  openMilliFils: number
  settlementBreakCount: number
  settlementExpectedNetMilliFils: number
  settlementReceivedMilliFils: number
  settlementResidueMilliFils: number
  dunningByState: Partial<Record<DunningState, number>>
  dsoByTpp: TppDsoSummary[]
}

export interface BillingCollectionsDeps {
  store: BillingCollectionsStore
  audit: HighClassAuditSink
}

/** All four emissions here are one scheduled actor, so the CODE-03 sentinels live in one place. */
const SYSTEM_ACTOR = {
  acting_principal: 'system:billing-collections',
  acting_persona: 'system',
  scope_used: SYSTEM_ACTOR_SCOPE,
  response_status: SYSTEM_ACTOR_RESPONSE_STATUS
} as const

export class BillingCollectionsService {
  constructor(private readonly deps: BillingCollectionsDeps) {}

  async ingestSettlement(input: SettlementInput, traceId: string): Promise<SettlementDecomposition> {
    const result = decomposeSettlement(input)
    const saved = await this.deps.store.saveSettlement(result, traceId)
    if (!saved.created) return result
    await this.deps.audit.emit({
      event_type: 'billing_settlement_decomposed',
      ...SYSTEM_ACTOR,
      request_trace_id: traceId,
      request_body: {
        settlement_reference: result.settlementReference,
        period: result.period,
        received_milli_fils: result.receivedMilliFils,
        expected_net_milli_fils: result.expectedNetMilliFils,
        residue_milli_fils: result.residueMilliFils,
        line_count: result.lines.length
      }
    })
    if (result.break) {
      await this.deps.audit.emit({
        event_type: 'billing_settlement_break_raised',
        ...SYSTEM_ACTOR,
        request_trace_id: traceId,
        request_body: {
          settlement_reference: result.settlementReference,
          period: result.period,
          residue_milli_fils: result.break.amountMilliFils,
          receivable_ledger_refs: result.break.receivableLedgerRefs,
          payable_ledger_refs: result.break.payableLedgerRefs
        }
      })
    }
    return result
  }

  async attachDirectCollection(
    invoice: CollectionInvoice,
    capabilities: { uaeddsMandate: boolean },
    selectedRail: DirectCollectionRail,
    policyRef: string,
    traceId: string
  ): Promise<DirectCollectionInvoice> {
    const eligibleRails = eligibleCollectionRails(invoice.amountMilliFils, capabilities)
    if (!eligibleRails.includes(selectedRail)) throw new Error(`${selectedRail} is not eligible for invoice ${invoice.invoiceId}`)
    if (!policyRef.trim()) throw new Error('policyRef is required')
    const record: DirectCollectionInvoice = { ...invoice, eligibleRails, selectedRail, policyRef }
    const saved = await this.deps.store.saveCollectionInvoice(record, traceId)
    if (!saved.created) return record
    const action: StoredCollectionAction = {
      invoiceId: invoice.invoiceId,
      fromState: 'current',
      toState: 'current',
      actionType: 'collection_requested',
      policyRef,
      occurredAt: invoice.issuedAt,
      traceId
    }
    await this.deps.store.appendCollectionAction(action)
    await this.deps.audit.emit({
      event_type: 'billing_collection_requested',
      ...SYSTEM_ACTOR,
      request_trace_id: traceId,
      request_body: {
        invoice_id: invoice.invoiceId,
        tpp_id: invoice.tppId,
        amount_milli_fils: invoice.amountMilliFils,
        eligible_rails: eligibleRails,
        selected_rail: selectedRail,
        policy_ref: policyRef
      }
    })
    return record
  }

  async progressDunning(invoiceId: string, asOf: string, policy: DunningPolicy, traceId: string): Promise<DunningEvaluation> {
    const invoice = await this.deps.store.collectionInvoice(invoiceId)
    if (!invoice) throw new Error(`unknown collection invoice ${invoiceId}`)
    if (invoice.policyRef !== policy.policyRef) throw new Error(`dunning policy ${policy.policyRef} does not match invoice policy ${invoice.policyRef}`)
    const evaluation = evaluateDunning(invoice, asOf, policy)
    const fromState = await this.deps.store.latestCollectionState(invoiceId) ?? 'current'
    if (evaluation.action.type === 'none' || evaluation.state === fromState) return evaluation
    const stored = await this.deps.store.appendCollectionAction({
      invoiceId,
      fromState,
      toState: evaluation.state,
      actionType: evaluation.action.type,
      policyRef: policy.policyRef,
      occurredAt: asOf,
      traceId
    })
    if (stored.created) {
      await this.deps.audit.emit({
        event_type: `billing_collection_${evaluation.action.type}`,
        ...SYSTEM_ACTOR,
        request_trace_id: traceId,
        request_body: {
          invoice_id: invoiceId,
          tpp_id: invoice.tppId,
          from_state: fromState,
          to_state: evaluation.state,
          days_overdue: evaluation.daysOverdue,
          policy_ref: policy.policyRef
        }
      })
    }
    return evaluation
  }

  async collectionSummary(period: string, asOf: string): Promise<CollectionsFinanceSummary> {
    const [invoices, actions, settlements] = await Promise.all([
      this.deps.store.listCollectionInvoices(),
      this.deps.store.listCollectionActions(),
      this.deps.store.listSettlements(period)
    ])
    const latest = new Map<string, DunningState>()
    for (const action of actions) if (action.occurredAt <= asOf) latest.set(action.invoiceId, action.toState)
    const dunningByState: Partial<Record<DunningState, number>> = {}
    for (const invoice of invoices) {
      const state = latest.get(invoice.invoiceId) ?? (invoice.settledAt ? 'settled' : 'current')
      dunningByState[state] = (dunningByState[state] ?? 0) + 1
    }
    const open = invoices.filter((invoice) => invoice.settledAt === null || invoice.settledAt > asOf)
    return {
      openInvoiceCount: open.length,
      openMilliFils: open.reduce((sum, invoice) => sum + invoice.amountMilliFils, 0),
      settlementBreakCount: settlements.filter((settlement) => settlement.break !== null).length,
      settlementExpectedNetMilliFils: settlements.reduce((sum, item) => sum + item.expectedNetMilliFils, 0),
      settlementReceivedMilliFils: settlements.reduce((sum, item) => sum + item.receivedMilliFils, 0),
      settlementResidueMilliFils: settlements.reduce((sum, item) => sum + item.residueMilliFils, 0),
      dunningByState,
      dsoByTpp: summarizeDsoByTpp(invoices, asOf)
    }
  }
}
