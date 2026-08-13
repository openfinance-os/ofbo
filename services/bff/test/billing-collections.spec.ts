import { describe, expect, it } from 'vitest'
import { aed, type DunningPolicy } from '@ofbo/billing'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { BillingCollectionsService, InMemoryBillingCollectionsStore } from '../src/billing/collections.js'

const policy: DunningPolicy = {
  policyRef: 'LFI-TPP-AGREEMENT-2026-01',
  stages: [
    { state: 'reminded', afterDaysOverdue: 1 },
    { state: 'overdue', afterDaysOverdue: 6 },
    { state: 'escalated', afterDaysOverdue: 14 },
    { state: 'suspension_risk', afterDaysOverdue: 30 }
  ]
}

function setup() {
  const store = new InMemoryBillingCollectionsStore()
  const audit = new InMemoryHighClassAuditSink()
  return { store, audit, service: new BillingCollectionsService({ store, audit }) }
}

describe('BILL-05 collections orchestration', () => {
  it('persists invoice-level dual-role decomposition and High-audits a residue break', async () => {
    const { service, store, audit } = setup()
    const result = await service.ingestSettlement({
      settlementReference: 'SET-2026-07-001',
      period: '2026-06',
      receivedMilliFils: aed(109.99),
      residueToleranceMilliFils: 0,
      receivables: [{ invoiceId: 'INV-1', tppId: 'TPP-1', amountMilliFils: aed(150), ledgerRef: 'AR-1' }],
      payables: [{ payableId: 'PAY-1', counterpartyId: 'NEBRAS', amountMilliFils: aed(40), ledgerRef: 'AP-1' }]
    }, 'trace-settlement')

    expect(result.break).not.toBeNull()
    expect(store.settlements[0]?.lines).toHaveLength(2)
    expect(store.settlements[0]?.break?.receivableLedgerRefs).toEqual(['AR-1'])
    expect(store.settlements[0]?.break?.payableLedgerRefs).toEqual(['AP-1'])
    expect(audit.events.map((event) => event.event_type)).toEqual([
      'billing_settlement_decomposed',
      'billing_settlement_break_raised'
    ])
  })

  it('attaches an eligible rail, progresses non-payment, and High-audits every action', async () => {
    const { service, audit } = setup()
    await service.attachDirectCollection({
      invoiceId: 'INV-1',
      tppId: 'TPP-1',
      issuedAt: '2026-07-01',
      dueAt: '2026-07-10',
      amountMilliFils: aed(10_000),
      settledAt: null
    }, { uaeddsMandate: true }, 'of_invoice_collection', policy.policyRef, 'trace-request')

    expect((await service.progressDunning('INV-1', '2026-07-12', policy, 'trace-reminder')).state).toBe('reminded')
    expect((await service.progressDunning('INV-1', '2026-07-18', policy, 'trace-overdue')).state).toBe('overdue')
    const evaluation = await service.progressDunning('INV-1', '2026-07-25', policy, 'trace-dunning')
    expect(evaluation.state).toBe('escalated')
    expect(audit.events.map((event) => event.event_type)).toEqual([
      'billing_collection_requested',
      'billing_collection_reminder',
      'billing_collection_overdue_notice',
      'billing_collection_escalation'
    ])
    expect(audit.events.every((event) => event.scope_used === 'billing:collect')).toBe(true)
  })

  it('rejects a selected rail that is not eligible for the invoice', async () => {
    const { service } = setup()
    await expect(service.attachDirectCollection({
      invoiceId: 'INV-1', tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10',
      amountMilliFils: aed(1_000), settledAt: null
    }, { uaeddsMandate: false }, 'of_invoice_collection', policy.policyRef, 'trace-request')).rejects.toThrow(/not eligible/)
  })

  it('provides the Finance View with dunning exposure, settlement breaks, and DSO per TPP', async () => {
    const { service } = setup()
    await service.ingestSettlement({
      settlementReference: 'SET-2026-07-001', period: '2026-06', receivedMilliFils: aed(9.99), residueToleranceMilliFils: 0,
      receivables: [{ invoiceId: 'INV-S', tppId: 'TPP-1', amountMilliFils: aed(10), ledgerRef: 'AR-S' }], payables: []
    }, 'trace-settlement')
    await service.attachDirectCollection({
      invoiceId: 'INV-D', tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10',
      amountMilliFils: aed(10_000), settledAt: null
    }, { uaeddsMandate: false }, 'of_invoice_collection', policy.policyRef, 'trace-request')
    await service.progressDunning('INV-D', '2026-07-25', policy, 'trace-dunning')

    await expect(service.collectionSummary('2026-06', '2026-07-25')).resolves.toEqual(expect.objectContaining({
      openInvoiceCount: 1,
      openMilliFils: aed(10_000),
      settlementBreakCount: 1,
      dunningByState: { escalated: 1 },
      dsoByTpp: [expect.objectContaining({ tppId: 'TPP-1', dsoDays: 24 })]
    }))
  })
})
