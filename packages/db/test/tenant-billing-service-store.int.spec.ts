import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import {
  buildProfitabilityReport,
  canonicalJson,
  type RevenueAssuranceReport
} from '../../billing/src/index.js'
import {
  applyMigrations,
  PgBillingMeteringStore,
  PgLineageEmitter,
  PgTenantBillingServiceStore,
  seedQueryPurposes
} from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const BANKS = [
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002',
  'b3000000-0000-4000-8000-000000000003'
] as const
const GROUPS = [
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000003'
] as const
const YEAR_ANCHORS = ['2025-08-01', '2025-09-01', '2025-10-01'] as const
const PERIOD = '2026-06'
const RUN_OFFSET = Number.parseInt(randomUUID().slice(0, 6), 16)
const BASE_RECEIVABLE = 100_000_000 + RUN_OFFSET
const BILLING_TABLES = [
  'billing_rate_card_version', 'billing_source_snapshot', 'billing_rate_card_review',
  'billing_record_set', 'invoice_run',
  'billing_event', 'billing_meter_run', 'billing_metered_line',
  'billing_expected_memo', 'billing_expected_memo_line',
  'billing_collection_memo_reconciliation', 'billing_memo_diff_line', 'billing_period_rerating',
  'billing_einvoice_document', 'billing_asp_submission',
  'billing_settlement_run', 'billing_settlement_line', 'billing_settlement_break',
  'billing_collection_invoice', 'billing_collection_action',
  'billing_accounting_batch', 'billing_journal_instruction', 'billing_journal_line', 'billing_journal_dispatch',
  'billing_revenue_recovery', 'billing_revenue_assurance_report', 'billing_revenue_assurance_finding',
  'tenant_configuration', 'billing_benchmark_snapshot'
]

const pool = new pg.Pool({ connectionString: DATABASE_URL })
const auditEvents: Record<string, unknown>[] = []
const lineageByBank = new Map<string, PgLineageEmitter>()
const lineageFor = (bankId: string): PgLineageEmitter => {
  let emitter = lineageByBank.get(bankId)
  if (!emitter) {
    emitter = new PgLineageEmitter(DATABASE_URL!, { bankId, channel: 'internal_retail' })
    lineageByBank.set(bankId, emitter)
  }
  return emitter
}
const store = new PgTenantBillingServiceStore(DATABASE_URL!, lineageFor, {
  emit: async (event) => { auditEvents.push(structuredClone(event)) }
})

async function asApp<T>(bankId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE ofbo_app')
    await client.query(`SELECT set_config('app.bank_id', $1, true)`, [bankId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function assurance(bankIndex: number): RevenueAssuranceReport {
  return {
    period: PERIOD,
    generatedAt: '2026-07-05T00:00:00.000Z',
    currency: 'AED',
    meteringCoveragePercent: 97 + bankIndex,
    grossReceivableMilliFils: BASE_RECEIVABLE,
    leakageMilliFils: 1_000_000,
    leakageAed: 1,
    leakagePercent: 1 + bankIndex / 10,
    counterfactualOpportunityMilliFils: 0,
    counterfactualOpportunityAed: 0,
    recoverableMilliFils: 1_000_000,
    recoveredRevenueMilliFils: 0,
    recoveredRevenueAed: 0,
    outstandingRecoverableMilliFils: 1_000_000,
    findings: [],
    varianceByFeeClass: [],
    recoveries: [],
    disputeWindow: { raised: 0, missed: 0, targetMissed: 0 },
    target: { thresholdPercent: 1, comparison: 'strictly_below', met: false },
    roiContribution: { feeVarianceRecoveredMilliFils: 0, feeVarianceRecoveredAed: 0 }
  }
}

function profitability(bankIndex: number) {
  return buildProfitabilityReport({
    period: PERIOD,
    receivables: [{ tppId: `TPP-${bankIndex}`, productFamily: 'data', amountMilliFils: BASE_RECEIVABLE + bankIndex * 10_000_000, sourceRefs: [`invoice:${bankIndex}:${RUN_OFFSET}`] }],
    hubCosts: [{ tppId: `TPP-${bankIndex}`, productFamily: 'tpp_aas', amountMilliFils: 10_000_000, sourceRefs: [`payable:${bankIndex}`] }],
    liabilityProvisions: [],
    tppAasMargins: []
  })
}

describe('BILL-10 tenant billing service', () => {
  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
    for (let index = 0; index < BANKS.length; index += 1) {
      await store.provisionTenant({
        bankId: BANKS[index]!,
        tenantGroupId: GROUPS[index]!,
        groupSlug: `bill-10-${index + 1}`,
        displayName: `Billing Tenant ${index + 1}`,
        tier: 'tier2',
        yearAnchorDate: YEAR_ANCHORS[index]!,
        retailOverageMilliFils: (index + 1) * 100_000,
        invoiceTemplateRef: `pint-ae:tenant-${index + 1}:v1`,
        invoiceBrandKey: `tenant-${index + 1}`,
        aspRouteProfile: `asp-tenant-${index + 1}`
      }, `provision-${index + 1}`)
    }
    await seedQueryPurposes(pool, BANKS[0], 'internal_retail')
  }, 60_000)

  afterAll(async () => {
    await store.close()
    await Promise.all([...lineageByBank.values()].map((lineage) => lineage.close()))
    await pool.end()
  })

  it('provisions distinct immutable configurations and enables RLS on every portable billing table', async () => {
    const first = await store.configuration(BANKS[0])
    const second = await store.configuration(BANKS[1])
    expect(first?.invoiceTemplateRef).toBe('pint-ae:tenant-1:v1')
    expect(second?.invoiceTemplateRef).toBe('pint-ae:tenant-2:v1')
    expect(first?.retailOverageMilliFils).toBe(100_000)
    expect(second?.retailOverageMilliFils).toBe(200_000)

    const result = await pool.query(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname = ANY($1::text[])`,
      [BILLING_TABLES]
    )
    const rls = new Map(result.rows.map((row) => [row.relname as string, row.relrowsecurity as boolean]))
    for (const table of BILLING_TABLES) expect(rls.get(table), table).toBe(true)
    const policies = await pool.query(
      `SELECT tablename FROM pg_policies
        WHERE schemaname='public' AND policyname='tenancy_select' AND tablename = ANY($1::text[])`,
      [BILLING_TABLES]
    )
    const policyTables = new Set(policies.rows.map((row) => row.tablename as string))
    for (const table of BILLING_TABLES) expect(policyTables.has(table), `${table} tenancy_select`).toBe(true)

    const crossTenantRows = await asApp(BANKS[0], async (client) => {
      const hidden = await client.query(`SELECT bank_id FROM tenant_configuration WHERE bank_id=$1`, [BANKS[1]])
      return hidden.rowCount
    })
    expect(crossTenantRows).toBe(0)
  })

  it('exports only the requesting tenant billing evidence', async () => {
    const suffix = randomUUID()
    const tenantA = new PgBillingMeteringStore(DATABASE_URL!, { bankId: BANKS[0], channel: 'internal_retail' })
    const tenantB = new PgBillingMeteringStore(DATABASE_URL!, { bankId: BANKS[1], channel: 'internal_retail' })
    try {
      for (const [metering, marker] of [[tenantA, 'A'], [tenantB, 'B']] as const) {
        await metering.ingestEvents([{
          eventId: `bill-10-${marker}-${suffix}`,
          source: 'integration-test',
          type: 'com.ofbo.billing.gateway-call.v1',
          occurredAt: '2026-06-15T12:00:00.000Z',
          eventHash: `sha256:${marker}-${suffix}`,
          eventPayload: { tenantMarker: marker },
          fapiInteractionId: randomUUID(),
          endpoint: '/open-finance/v1/accounts',
          outcome: 200,
          direction: 'inbound',
          tppId: `TPP-${marker}`,
          psuId: null
        }], suffix)
      }
      const exported = await store.portableExport(BANKS[0], '2026-08-13T00:00:00.000Z')
      const serialized = JSON.stringify(exported)
      expect(exported.recordCounts.billing_event).toBeGreaterThanOrEqual(1)
      expect(serialized).toContain(`bill-10-A-${suffix}`)
      expect(serialized).not.toContain(`bill-10-B-${suffix}`)
      const tenantEvent = exported.tables.billing_event?.find((row) => row.event_id === `bill-10-A-${suffix}`)
      expect(tenantEvent?.event_payload).toMatchObject({ tenantMarker: 'A' })
      expect(exported.sha256).toBe(`sha256:${createHash('sha256').update(canonicalJson({
        schema_version: exported.schemaVersion,
        bank_id: exported.bankId,
        generated_at: exported.generatedAt,
        record_counts: exported.recordCounts,
        tables: exported.tables
      })).digest('hex')}`)
    } finally {
      await tenantA.close()
      await tenantB.close()
    }
  }, 60_000)

  it('coexists with tenant-scoped assurance and exposes only a governed k-anonymous benchmark', async () => {
    await expect(store.crossTenantBenchmark({
      authorizingBankId: BANKS[0],
      purposeCode: `unapproved-${randomUUID()}`,
      period: PERIOD,
      actingPrincipal: 'demo:finance-manager',
      actingPersona: 'finance-manager',
      traceId: randomUUID()
    })).rejects.toThrow(/not registered\+approved/)

    for (let index = 0; index < BANKS.length; index += 1) {
      expect((await store.publishBenchmark(BANKS[index]!, {
        period: PERIOD,
        profitability: profitability(index),
        assurance: assurance(index)
      }, `benchmark-${index}`)).created).toBe(true)
    }
    const lineage = await pool.query(
      `SELECT DISTINCT table_name FROM lineage_events
        WHERE table_name = ANY($1::text[])`,
      [['tenant_configuration', 'billing_benchmark_snapshot']]
    )
    expect(new Set(lineage.rows.map((row) => row.table_name))).toEqual(
      new Set(['tenant_configuration', 'billing_benchmark_snapshot'])
    )
    const benchmark = await store.crossTenantBenchmark({
      authorizingBankId: BANKS[0],
      purposeCode: 'billing_cross_tenant_benchmark',
      period: PERIOD,
      actingPrincipal: 'demo:finance-manager',
      actingPersona: 'finance-manager',
      traceId: randomUUID()
    })
    expect(benchmark.tenantCount).toBe(3)
    expect(benchmark).not.toHaveProperty('tenants')
    expect(benchmark.averages.receivableMilliFils).toBe(BASE_RECEIVABLE + 10_000_000)
    expect(auditEvents.at(-1)?.event_type).toBe('cross_tenant_billing_benchmark')
  }, 60_000)
})
