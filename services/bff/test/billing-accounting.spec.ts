import { describe, expect, it, vi } from 'vitest'
import type { AccountingAccountMap, AccountingBatchInput, PintAeDocument } from '@ofbo/billing'
import { BillingAccountingService, InMemoryBillingAccountingStore } from '../src/billing/accounting.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'

const accounts: AccountingAccountMap = {
  status: 'approved', profileRef: 'BANK-COA-2026-01', receivableControl: 'AR-OF', schemePayable: 'AP-NEBRAS',
  cash: 'CASH-SETTLEMENT', outputVat: 'VAT-OUTPUT', settlementSuspense: 'SUSPENSE-SETTLEMENT',
  revenueByFeeClass: { 'payment.merchant_collection': 'REV-PAYMENTS' },
  hubExpenseByFeeClass: { 'hub.standard': 'EXP-NEBRAS' }
}

const document: PintAeDocument = {
  documentId: 'INV-2026-06-TPP-1', uuid: '11111111-1111-4111-8111-111111111111', documentType: '380',
  buyerId: 'TPP-1', period: '2026-06', issueDate: '2026-07-05', transactionType: '00000000', taxCategory: 'S',
  grossFils: 10_500, netFils: 10_000, vatFils: 500, tddRequired: true, vatPostureDecisionRef: 'BD-19-TAX-001',
  customizationId: 'urn:peppol:pint:billing-1@ae-1', profileId: 'urn:peppol:bis:billing', xml: '<Invoice/>',
  pdf: new Uint8Array(), sourceLineRefs: ['meter-line-1']
}

const input = (map: AccountingAccountMap = accounts): AccountingBatchInput => ({
  period: '2026-06', postingDate: '2026-07-31', accounts: map,
  invoices: [{ document, revenueSplits: [{ feeClass: 'payment.merchant_collection', netFils: 10_000 }] }],
  hubPayables: [{ sourceId: 'HUB-2026-06', feeClass: 'hub.standard', amountFils: 2_000 }], settlements: []
})

describe('BILL-07 accounting execution boundary', () => {
  it('persists a balanced immutable batch before P9 and appends an accepted attempt', async () => {
    const store = new InMemoryBillingAccountingStore()
    const audit = new InMemoryHighClassAuditSink()
    const postJournalInstructions = vi.fn(async () => ({ accepted: true, journal_batch_ref: 'p9-journal-1' }))
    const service = new BillingAccountingService({ store, audit, financialSystem: { postJournalInstructions } })

    const result = await service.generateAndDispatch(input(), 'demo', 'trace-accounting-1')

    expect(result).toMatchObject({ accepted: true, journalBatchRef: 'p9-journal-1' })
    expect(store.batches).toHaveLength(1)
    expect(store.dispatches).toEqual([expect.objectContaining({ attemptNo: 1, status: 'accepted', journalBatchRef: 'p9-journal-1' })])
    expect(postJournalInstructions).toHaveBeenCalledWith(expect.objectContaining({
      batch_id: 'GL-2026-06-BANK-COA-2026-01', account_profile_ref: 'BANK-COA-2026-01'
    }), { trace_id: 'trace-accounting-1' })
    expect(audit.events.map((event) => event.event_type)).toEqual(['billing_accounting_batch_generated', 'billing_journal_batch_dispatched'])
    expect(await service.accountingClosePack('2026-06')).toEqual(expect.objectContaining({ balanced: true, outputVatFils: 500, payableSourceIds: ['HUB-2026-06'] }))
  })

  it('preserves the generated evidence and records a transport failure', async () => {
    const store = new InMemoryBillingAccountingStore()
    const audit = new InMemoryHighClassAuditSink()
    const service = new BillingAccountingService({ store, audit, financialSystem: { postJournalInstructions: async () => { throw new Error('P9 unavailable') } } })
    await expect(service.generateAndDispatch(input(), 'enterprise', 'trace-accounting-2')).rejects.toThrow('P9 unavailable')
    expect(store.batches).toHaveLength(1)
    expect(store.dispatches).toEqual([expect.objectContaining({ status: 'transport_error', accepted: false, errorDetail: 'P9 unavailable' })])
    expect(audit.events.at(-1)?.event_type).toBe('billing_journal_batch_dispatch_failed')
  })

  it('fails closed before persistence or P9 when the bank account map is not approved', async () => {
    const store = new InMemoryBillingAccountingStore()
    const postJournalInstructions = vi.fn()
    const service = new BillingAccountingService({ store, audit: new InMemoryHighClassAuditSink(), financialSystem: { postJournalInstructions } })
    await expect(service.generateAndDispatch(input({ ...accounts, status: 'draft' }), 'demo', 'trace-accounting-3')).rejects.toThrow(/approved account map/)
    expect(store.batches).toHaveLength(0)
    expect(postJournalInstructions).not.toHaveBeenCalled()
  })
})
