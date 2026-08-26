import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { aed, decomposeSettlement } from '../../billing/src/index.js'
import { applyMigrations, PgBillingCollectionsStore, PgLineageEmitter } from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('PgBillingCollectionsStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingCollectionsStore(DATABASE_URL!, TENANCY, lineage)

  beforeAll(async () => applyMigrations(DATABASE_URL!), 60_000)
  afterAll(async () => {
    await store.close()
    await lineage.close()
  })

  it('persists immutable decomposition and append-only dunning actions under tenant RLS', async () => {
    const suffix = randomUUID()
    const traceId = randomUUID()
    const result = decomposeSettlement({
      settlementReference: `SET-${suffix}`,
      period: '2026-06',
      receivedMilliFils: aed(109.99),
      residueToleranceMilliFils: 0,
      receivables: [{ invoiceId: `INV-S-${suffix}`, tppId: 'TPP-1', amountMilliFils: aed(150), ledgerRef: `AR-${suffix}` }],
      payables: [{ payableId: `PAY-${suffix}`, counterpartyId: 'NEBRAS', amountMilliFils: aed(40), ledgerRef: `AP-${suffix}` }]
    })
    expect((await store.saveSettlement(result, traceId)).created).toBe(true)
    expect((await store.saveSettlement(result, traceId)).created).toBe(false)
    expect((await store.listSettlements('2026-06')).find((item) => item.settlementReference === result.settlementReference)?.break).toMatchObject({
      receivableLedgerRefs: [`AR-${suffix}`], payableLedgerRefs: [`AP-${suffix}`]
    })

    const invoice = {
      invoiceId: `INV-D-${suffix}`, tppId: 'TPP-1', issuedAt: '2026-07-01', dueAt: '2026-07-10',
      amountMilliFils: aed(10_000), settledAt: null,
      eligibleRails: ['of_invoice_collection', 'aani_request_to_pay'] as ('of_invoice_collection' | 'aani_request_to_pay')[],
      selectedRail: 'of_invoice_collection' as const,
      policyRef: 'LFI-TPP-AGREEMENT-2026-01'
    }
    expect((await store.saveCollectionInvoice(invoice, traceId)).created).toBe(true)
    expect((await store.appendCollectionAction({
      invoiceId: invoice.invoiceId, fromState: 'current', toState: 'current', actionType: 'collection_requested',
      policyRef: invoice.policyRef, occurredAt: invoice.issuedAt, traceId
    })).created).toBe(true)
    expect((await store.appendCollectionAction({
      invoiceId: invoice.invoiceId, fromState: 'current', toState: 'escalated', actionType: 'escalation',
      policyRef: invoice.policyRef, occurredAt: '2026-07-25', traceId
    })).created).toBe(true)
    expect(await store.latestCollectionState(invoice.invoiceId)).toBe('escalated')

    const otherTenant = new PgBillingCollectionsStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect(await otherTenant.collectionInvoice(invoice.invoiceId)).toBeNull()
    await otherTenant.close()
  }, 60_000)
})
