import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAccountingBatch, buildAccountingClosePack } from '../../billing/src/index.js'
import { applyMigrations, PgBillingAccountingStore, PgLineageEmitter } from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('PgBillingAccountingStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingAccountingStore(DATABASE_URL!, TENANCY, lineage)

  beforeAll(async () => applyMigrations(DATABASE_URL!), 60_000)
  afterAll(async () => { await store.close(); await lineage.close() })

  it('persists a balanced immutable batch, nested lines, and append-only P9 attempts under tenant RLS', async () => {
    const suffix = randomUUID()
    const traceId = randomUUID()
    const batch = buildAccountingBatch({
      period: '2026-06', postingDate: '2026-07-31',
      accounts: {
        status: 'approved', profileRef: `BANK-COA-${suffix}`, receivableControl: 'AR-OF', schemePayable: 'AP-NEBRAS',
        cash: 'CASH-SETTLEMENT', outputVat: 'VAT-OUTPUT', settlementSuspense: 'SUSPENSE-SETTLEMENT',
        revenueByFeeClass: {}, hubExpenseByFeeClass: { 'hub.standard': 'EXP-NEBRAS' }
      },
      invoices: [], hubPayables: [{ sourceId: `HUB-${suffix}`, feeClass: 'hub.standard', amountFils: 2_000 }], settlements: []
    })
    const closePack = buildAccountingClosePack(batch)
    const saved = await store.saveBatch(batch, closePack, traceId)
    expect(saved.created).toBe(true)
    expect((await store.saveBatch(batch, closePack, traceId)).created).toBe(false)
    await expect(store.saveBatch({ ...batch, accountProfileRef: 'DIFFERENT-PROFILE' }, closePack, traceId)).rejects.toThrow(/conflicting immutable/)

    expect(await store.appendDispatch({
      batchArtifactId: saved.id, adapterProfile: 'enterprise', traceId, accepted: false,
      status: 'transport_error', errorDetail: 'test transport outage'
    })).toMatchObject({ attemptNo: 1 })
    expect(await store.appendDispatch({
      batchArtifactId: saved.id, adapterProfile: 'enterprise', traceId, accepted: true,
      status: 'accepted', journalBatchRef: `P9-${suffix}`
    })).toMatchObject({ attemptNo: 2 })
    expect(await store.accountingClosePack('2026-06')).toEqual(expect.objectContaining({ batchId: batch.batchId, balanced: true, payableSourceIds: [`HUB-${suffix}`] }))

    const otherTenant = new PgBillingAccountingStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect(await otherTenant.accountingClosePack('2026-06')).toBeNull()
    await otherTenant.close()
  }, 60_000)
})
