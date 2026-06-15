import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgAuditEmitter, PgNebrasSnapshotStore, PgNebrasAggregateStore } from '@ofbo/db'
import { NebrasIngestionService, InMemoryWarmTierExporter } from '../src/analytics/ingestion.js'

/**
 * BACKOFFICE-32 integration: ingestion lands nebras_ingest_snapshot + refreshes
 * nebras_report_aggregate under RLS with BCBS 239 lineage; a re-run is idempotent;
 * an exhausted back-off retains the last-good snapshot and flags the period stale
 * (amber) — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const PERIOD = '2026-09' // a period the shared DB won't otherwise touch

const ROWS = [
  { channel: 'internal_retail', line_type: 'payment_settlement', fee: { amount: 250, currency: 'AED' } },
  { channel: 'internal_retail', line_type: 'payment_settlement', fee: { amount: 250, currency: 'AED' } },
  { channel: 'internal_retail', line_type: 'lfi_access_log', fee: { amount: 50, currency: 'AED' } }
]

function egress(failForever = false) {
  return {
    async fetchTppReports() {
      if (failForever) throw new Error('429')
      return { published_at: `${PERIOD}-28T00:00:00.000Z`, rows: ROWS }
    },
    async fetchDataset() {
      if (failForever) throw new Error('429')
      return { published_at: `${PERIOD}-28T00:00:00.000Z`, rows: [{ consent_id: 'c1', status: 'Authorized' }] }
    }
  }
}

const fastSleep = async (): Promise<void> => undefined

describe('Nebras ingestion — snapshot + aggregate persistence under RLS + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const snapshots = new PgNebrasSnapshotStore(url!, TENANCY, lineage)
  const aggregates = new PgNebrasAggregateStore(url!, TENANCY, lineage)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await snapshots.close()
    await aggregates.close()
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('lands snapshots + refreshes aggregates under RLS with lineage, idempotently', async () => {
    const svc = new NebrasIngestionService({ egress: egress(), snapshots, aggregates, audit, warmExporter: new InMemoryWarmTierExporter(), backoff: { sleep: fastSleep } })
    const trace = randomUUID()

    const result = await svc.runIngestion(PERIOD, trace)
    expect(result.stale_sources).toBe(0)
    expect(result.aggregates_refreshed).toBe(2)

    // snapshots persisted (tpp_reports + dataset), warm-exported
    const snaps = await admin.query(`SELECT source, row_count, warm_export_state, warm_object_key FROM nebras_ingest_snapshot WHERE period = $1 ORDER BY source`, [PERIOD])
    expect(snaps.rows).toHaveLength(2)
    expect(snaps.rows.every((r) => r.warm_export_state === 'exported' && r.warm_object_key)).toBe(true)

    // aggregates materialized per channel×line_type
    const aggs = await admin.query(`SELECT line_type, total_fee_minor, line_count, freshness FROM nebras_report_aggregate WHERE period = $1 ORDER BY line_type`, [PERIOD])
    expect(aggs.rows.map((r) => r.line_type)).toEqual(['lfi_access_log', 'payment_settlement'])
    const payment = aggs.rows.find((r) => r.line_type === 'payment_settlement')!
    expect(Number(payment.total_fee_minor)).toBe(500)
    expect(Number(payment.line_count)).toBe(2)
    expect(payment.freshness).toBe('fresh')

    // lineage emitted for both tables
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'nebras_ingest_snapshot'`, [trace])).rows.length).toBeGreaterThan(0)
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'nebras_report_aggregate'`, [trace])).rows.length).toBeGreaterThan(0)

    // idempotent re-run: same run_ids → no duplicate snapshot rows
    await svc.runIngestion(PERIOD, randomUUID())
    const after = await admin.query(`SELECT count(*)::int AS n FROM nebras_ingest_snapshot WHERE period = $1`, [PERIOD])
    expect(after.rows[0].n).toBe(2)
  })

  it('exhausted back-off flags the period stale (amber) and retains last-good', async () => {
    const failing = new NebrasIngestionService({ egress: egress(true), snapshots, aggregates, audit, backoff: { maxAttempts: 2, baseDelayMs: 1, sleep: fastSleep } })
    const result = await failing.runIngestion(PERIOD, randomUUID(), [{ source: 'tpp_reports' }])

    expect(result.sources[0]!.outcome).toBe('stale_fallback')
    expect(result.sources[0]!.snapshot_id).not.toBeNull() // last-good retained from the prior run

    const aggs = await admin.query(`SELECT DISTINCT freshness FROM nebras_report_aggregate WHERE period = $1`, [PERIOD])
    expect(aggs.rows.map((r) => r.freshness)).toEqual(['stale'])
  })
})
