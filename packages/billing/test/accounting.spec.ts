import { describe, expect, it } from 'vitest'
import {
  buildAccountingBatch,
  buildAccountingClosePack,
  type AccountingAccountMap,
  type PintAeDocument,
  type SettlementDecomposition
} from '../src/index.js'

const accounts: AccountingAccountMap = {
  status: 'approved',
  profileRef: 'BANK-COA-2026-01',
  receivableControl: 'AR-OPEN-FINANCE',
  schemePayable: 'AP-NEBRAS',
  cash: 'CASH-SETTLEMENT',
  outputVat: 'VAT-OUTPUT',
  settlementSuspense: 'SUSPENSE-OF-SETTLEMENT',
  revenueByFeeClass: {
    'payment.merchant_collection': 'REV-OF-PAYMENTS',
    'data.corporate_page': 'REV-OF-DATA'
  },
  hubExpenseByFeeClass: {
    'hub.standard': 'EXP-NEBRAS-HUB',
    'hub.paired': 'EXP-NEBRAS-HUB',
    'hub.quote': 'EXP-NEBRAS-HUB'
  }
}

function document(overrides: Partial<PintAeDocument> = {}): PintAeDocument {
  return {
    documentId: 'INV-2026-06-TPP-1', uuid: '11111111-1111-4111-8111-111111111111',
    documentType: '380', buyerId: 'TPP-1', period: '2026-06', issueDate: '2026-07-05',
    transactionType: '00000000', taxCategory: 'S', grossFils: 10_500, netFils: 10_000,
    vatFils: 500, tddRequired: true, vatPostureDecisionRef: 'BD-19-TAX-001',
    customizationId: 'urn:peppol:pint:billing-1@ae-1', profileId: 'urn:peppol:bis:billing',
    xml: '<Invoice/>', pdf: new Uint8Array(), sourceLineRefs: ['2026-06|TPP-1|payment.merchant_collection'],
    ...overrides
  }
}

function settlement(overrides: Partial<SettlementDecomposition> = {}): SettlementDecomposition {
  return {
    settlementReference: 'SET-2026-07-001', period: '2026-06', receivedMilliFils: 7_999_000,
    expectedNetMilliFils: 8_000_000, residueMilliFils: -1_000, residueToleranceMilliFils: 0,
    lines: [
      { role: 'lfi_receivable', sourceId: 'INV-2026-06-TPP-1', counterpartyId: 'TPP-1', signedMilliFils: 10_000_000, ledgerRef: 'AR-001' },
      { role: 'tpp_of_record_payable', sourceId: 'HUB-2026-06', counterpartyId: 'NEBRAS', signedMilliFils: -2_000_000, ledgerRef: 'AP-001' }
    ],
    break: {
      type: 'settlement_residue', settlementReference: 'SET-2026-07-001', period: '2026-06',
      amountMilliFils: -1_000, receivableLedgerRefs: ['AR-001'], payableLedgerRefs: ['AP-001']
    },
    ...overrides
  }
}

describe('BILL-07 balanced accounting instructions', () => {
  it('posts domestic invoice revenue and output VAT from the issued PINT AE artifact', () => {
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts,
      invoices: [{ document: document(), revenueSplits: [{ feeClass: 'payment.merchant_collection', netFils: 10_000 }] }],
      hubPayables: [], settlements: []
    })
    expect(batch.journals[0]).toMatchObject({ sourceType: 'pint_ae_invoice', sourceId: 'INV-2026-06-TPP-1', debitFils: 10_500, creditFils: 10_500 })
    expect(batch.journals[0]?.lines).toEqual([
      expect.objectContaining({ account: 'AR-OPEN-FINANCE', side: 'debit', amountFils: 10_500 }),
      expect.objectContaining({ account: 'REV-OF-PAYMENTS', side: 'credit', amountFils: 10_000 }),
      expect.objectContaining({ account: 'VAT-OUTPUT', side: 'credit', amountFils: 500 })
    ])
  })

  it('posts a 381 credit note as an exact reversal and a zero-rated export without VAT', () => {
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts,
      invoices: [
        { document: document({ documentId: 'CN-1', documentType: '381' }), revenueSplits: [{ feeClass: 'payment.merchant_collection', netFils: 10_000 }] },
        { document: document({ documentId: 'INV-Z', taxCategory: 'Z', transactionType: '00000001', grossFils: 4_000, netFils: 4_000, vatFils: 0 }), revenueSplits: [{ feeClass: 'data.corporate_page', netFils: 4_000 }] }
      ],
      hubPayables: [], settlements: []
    })
    expect(batch.journals[0]?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: 'AR-OPEN-FINANCE', side: 'credit', amountFils: 10_500 }),
      expect.objectContaining({ account: 'VAT-OUTPUT', side: 'debit', amountFils: 500 })
    ]))
    expect(batch.journals[1]?.lines.some((line) => line.account === 'VAT-OUTPUT')).toBe(false)
  })

  it('posts Hub payables and clears both ledgers through net settlement with residue suspense', () => {
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts, invoices: [],
      hubPayables: [{ sourceId: 'HUB-2026-06', feeClass: 'hub.standard', amountFils: 2_000 }],
      settlements: [settlement()]
    })
    expect(batch.journals[0]?.lines).toEqual([
      expect.objectContaining({ account: 'EXP-NEBRAS-HUB', side: 'debit', amountFils: 2_000 }),
      expect.objectContaining({ account: 'AP-NEBRAS', side: 'credit', amountFils: 2_000 })
    ])
    expect(batch.journals[1]).toMatchObject({ debitFils: 10_000, creditFils: 10_000 })
    expect(batch.journals[1]?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: 'CASH-SETTLEMENT', side: 'debit', amountFils: 7_999 }),
      expect.objectContaining({ account: 'AP-NEBRAS', side: 'debit', amountFils: 2_000 }),
      expect.objectContaining({ account: 'AR-OPEN-FINANCE', side: 'credit', amountFils: 10_000 }),
      expect.objectContaining({ account: 'SUSPENSE-OF-SETTLEMENT', side: 'debit', amountFils: 1 })
    ]))
  })

  it('fails closed on an unapproved or incomplete bank account map and inconsistent VAT source totals', () => {
    expect(() => buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts: { ...accounts, status: 'draft' },
      invoices: [], hubPayables: [], settlements: []
    })).toThrow(/approved account map/)
    expect(() => buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts,
      invoices: [{ document: document(), revenueSplits: [{ feeClass: 'payment.merchant_collection', netFils: 9_999 }] }],
      hubPayables: [], settlements: []
    })).toThrow(/revenue splits/)
  })

  it('builds a locked month-close evidence pack covering VAT, both role ledgers, and settlement', () => {
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31', accounts,
      invoices: [{ document: document(), revenueSplits: [{ feeClass: 'payment.merchant_collection', netFils: 10_000 }] }],
      hubPayables: [{ sourceId: 'HUB-2026-06', feeClass: 'hub.standard', amountFils: 2_000 }],
      settlements: [settlement()]
    })
    expect(buildAccountingClosePack(batch)).toEqual(expect.objectContaining({
      period: '2026-06', balanced: true, invoiceDocumentIds: ['INV-2026-06-TPP-1'],
      payableSourceIds: ['HUB-2026-06'], settlementReferences: ['SET-2026-07-001'],
      outputVatFils: 500, settlementResidueFils: -1, journalCount: 3
    }))
  })
})
