import { describe, expect, it } from 'vitest'
import {
  aed,
  decomposeSettlement,
  eligibleCollectionRails,
  evaluateDunning,
  summarizeDsoByTpp,
  type DunningPolicy
} from '../src/index.js'

const agreementPolicy: DunningPolicy = {
  policyRef: 'LFI-TPP-AGREEMENT-2026-01',
  stages: [
    { state: 'reminded', afterDaysOverdue: 1 },
    { state: 'overdue', afterDaysOverdue: 6 },
    { state: 'escalated', afterDaysOverdue: 14 },
    { state: 'suspension_risk', afterDaysOverdue: 30 }
  ]
}

describe('BILL-05 net-settlement decomposition', () => {
  it('explains a dual-role period invoice-by-invoice and payable-by-payable', () => {
    const result = decomposeSettlement({
      settlementReference: 'SET-2026-07-001',
      period: '2026-06',
      receivedMilliFils: aed(110),
      residueToleranceMilliFils: 0,
      receivables: [
        { invoiceId: 'INV-001', tppId: 'TPP-1', amountMilliFils: aed(100), ledgerRef: 'AR-001' },
        { invoiceId: 'INV-002', tppId: 'TPP-2', amountMilliFils: aed(50), ledgerRef: 'AR-002' }
      ],
      payables: [
        { payableId: 'PAY-001', counterpartyId: 'NEBRAS', amountMilliFils: aed(40), ledgerRef: 'AP-001' }
      ]
    })

    expect(result.expectedNetMilliFils).toBe(aed(110))
    expect(result.residueMilliFils).toBe(0)
    expect(result.break).toBeNull()
    expect(result.lines).toEqual([
      expect.objectContaining({ role: 'lfi_receivable', sourceId: 'INV-001', signedMilliFils: aed(100), ledgerRef: 'AR-001' }),
      expect.objectContaining({ role: 'lfi_receivable', sourceId: 'INV-002', signedMilliFils: aed(50), ledgerRef: 'AR-002' }),
      expect.objectContaining({ role: 'tpp_of_record_payable', sourceId: 'PAY-001', signedMilliFils: -aed(40), ledgerRef: 'AP-001' })
    ])
  })

  it('raises an unexplained-residue break that references both role ledgers', () => {
    const result = decomposeSettlement({
      settlementReference: 'SET-2026-07-002',
      period: '2026-06',
      receivedMilliFils: aed(109.99),
      residueToleranceMilliFils: 0,
      receivables: [
        { invoiceId: 'INV-001', tppId: 'TPP-1', amountMilliFils: aed(150), ledgerRef: 'AR-001' }
      ],
      payables: [
        { payableId: 'PAY-001', counterpartyId: 'NEBRAS', amountMilliFils: aed(40), ledgerRef: 'AP-001' }
      ]
    })

    expect(result.residueMilliFils).toBe(-aed(0.01))
    expect(result.break).toEqual(expect.objectContaining({
      type: 'settlement_residue',
      amountMilliFils: -aed(0.01),
      receivableLedgerRefs: ['AR-001'],
      payableLedgerRefs: ['AP-001']
    }))
  })

  it('rejects duplicate source and ledger references rather than double-netting them', () => {
    expect(() => decomposeSettlement({
      settlementReference: 'SET-2026-07-003',
      period: '2026-06',
      receivedMilliFils: aed(20),
      residueToleranceMilliFils: 0,
      receivables: [
        { invoiceId: 'INV-001', tppId: 'TPP-1', amountMilliFils: aed(10), ledgerRef: 'AR-001' },
        { invoiceId: 'INV-001', tppId: 'TPP-1', amountMilliFils: aed(10), ledgerRef: 'AR-002' }
      ],
      payables: []
    })).toThrow(/duplicate receivable source/)
  })
})

describe('BILL-05 direct collections and dunning', () => {
  it('returns all eligible rails in the overlapping AED 5,000–50,000 band', () => {
    expect(eligibleCollectionRails(aed(10_000), { uaeddsMandate: true })).toEqual([
      'of_invoice_collection',
      'aani_request_to_pay',
      'uaedds'
    ])
    expect(eligibleCollectionRails(aed(5_000), { uaeddsMandate: false })).toEqual(['aani_request_to_pay'])
    expect(eligibleCollectionRails(aed(50_000), { uaeddsMandate: true })).toEqual(['of_invoice_collection', 'uaedds'])
  })

  it('uses agreement-configured thresholds and produces exactly one next collection action', () => {
    expect(evaluateDunning({
      invoiceId: 'INV-001',
      tppId: 'TPP-1',
      issuedAt: '2026-07-05',
      dueAt: '2026-07-10',
      amountMilliFils: aed(100),
      settledAt: null
    }, '2026-07-25', agreementPolicy)).toMatchObject({
      state: 'escalated',
      daysOverdue: 15,
      action: { type: 'escalation', policyRef: 'LFI-TPP-AGREEMENT-2026-01' }
    })
  })

  it('rejects a policy whose contractual thresholds reverse the dunning ladder', () => {
    expect(() => evaluateDunning({
      invoiceId: 'INV-001', tppId: 'TPP-1', issuedAt: '2026-07-05', dueAt: '2026-07-10',
      amountMilliFils: aed(100), settledAt: null
    }, '2026-07-25', {
      policyRef: 'BAD-AGREEMENT',
      stages: [
        { state: 'overdue', afterDaysOverdue: 1 },
        { state: 'reminded', afterDaysOverdue: 6 }
      ]
    })).toThrow(/ladder order/)
  })

  it('tracks amount-weighted collection days per TPP, including open invoices as at the view date', () => {
    const summary = summarizeDsoByTpp([
      { invoiceId: 'INV-1', tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10', amountMilliFils: aed(100), settledAt: '2026-07-11' },
      { invoiceId: 'INV-2', tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10', amountMilliFils: aed(300), settledAt: null },
      { invoiceId: 'INV-3', tppId: 'TPP-2', issuedAt: '2026-07-10', dueAt: '2026-07-20', amountMilliFils: aed(50), settledAt: '2026-07-15' }
    ], '2026-07-21')

    expect(summary).toEqual([
      expect.objectContaining({ tppId: 'TPP-1', dsoDays: 18, openInvoiceCount: 1, openMilliFils: aed(300) }),
      expect.objectContaining({ tppId: 'TPP-2', dsoDays: 5, openInvoiceCount: 0, openMilliFils: 0 })
    ])
  })

  it('does not treat a future settlement as settled in an earlier as-of view', () => {
    const invoice = {
      invoiceId: 'INV-1', tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10',
      amountMilliFils: aed(100), settledAt: '2026-07-30'
    }
    expect(evaluateDunning(invoice, '2026-07-25', agreementPolicy).state).toBe('escalated')
    expect(summarizeDsoByTpp([invoice], '2026-07-25')[0]).toMatchObject({ dsoDays: 24, openInvoiceCount: 1 })
  })
})
