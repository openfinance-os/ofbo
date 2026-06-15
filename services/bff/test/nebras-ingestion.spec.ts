import { describe, expect, it } from 'vitest'
import {
  NebrasIngestionService,
  InMemoryWarmTierExporter,
  type NebrasSnapshotSink,
  type NebrasAggregateSink,
  type SnapshotRow
} from '../src/analytics/ingestion.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'

/**
 * BACKOFFICE-32 — the ingestion job polls Nebras via P6 with exponential back-off,
 * lands snapshots, writes the warm copy, refreshes materialized aggregates, and on
 * exhausted failure retains last-good + flags the period stale (amber).
 */

const PERIOD = '2026-05'
const REPORT_ROWS = [
  { channel: 'internal_retail', line_type: 'payment_settlement', fee: { amount: 250, currency: 'AED' } },
  { channel: 'internal_retail', line_type: 'payment_settlement', fee: { amount: 250, currency: 'AED' } },
  { channel: 'internal_retail', line_type: 'lfi_access_log', fee: { amount: 50, currency: 'AED' } }
]

class FakeSnapshotStore implements NebrasSnapshotSink {
  created: { run_id: string; source: string; published_at: string; rows: number }[] = []
  exported: { id: string; key: string }[] = []
  lastGood: { snapshot_id: string } | null = null
  private seq = 0
  async create(input: { source: 'tpp_reports' | 'dataset'; dataset_name?: string | null; period: string; run_id: string; published_at: string; rows: Record<string, unknown>[] }) {
    this.created.push({ run_id: input.run_id, source: input.source, published_at: input.published_at, rows: input.rows.length })
    const snapshot: SnapshotRow = { snapshot_id: `snap-${++this.seq}`, source: input.source, period: input.period, rows: input.rows }
    this.lastGood = { snapshot_id: snapshot.snapshot_id }
    return { snapshot, created: true }
  }
  async markWarmExported(snapshotId: string, objectKey: string) {
    this.exported.push({ id: snapshotId, key: objectKey })
  }
  async latestGood() {
    return this.lastGood
  }
}

class FakeAggregateStore implements NebrasAggregateSink {
  refreshed: { period: string; channel: string; line_type: string; total_fee_minor: number; line_count: number }[] = []
  staleCalls: string[] = []
  async refresh(inputs: { period: string; channel: string; line_type: string; total_fee_minor: number; line_count: number; currency: string; source_published_at: string }[]) {
    this.refreshed.push(...inputs)
    return inputs
  }
  async markStale(period: string) {
    this.staleCalls.push(period)
    return 1
  }
}

/** Egress that fails the first `failFirst` calls per source, then succeeds. */
function fakeEgress(failFirst = 0) {
  const calls = { tpp_reports: 0, dataset: 0 }
  return {
    calls,
    async fetchTppReports() {
      calls.tpp_reports += 1
      if (calls.tpp_reports <= failFirst) throw new Error('429 rate limited')
      return { published_at: '2026-05-28T00:00:00.000Z', rows: REPORT_ROWS }
    },
    async fetchDataset() {
      calls.dataset += 1
      if (calls.dataset <= failFirst) throw new Error('429 rate limited')
      return { published_at: '2026-05-28T00:00:00.000Z', rows: [{ consent_id: 'c1', status: 'Authorized' }] }
    }
  }
}

const fastBackoff = () => {
  const delays: number[] = []
  return { policy: { maxAttempts: 4, baseDelayMs: 100, sleep: async (ms: number) => void delays.push(ms) }, delays }
}

describe('NebrasIngestionService — happy path', () => {
  it('ingests TPP reports + dataset, refreshes per channel×line_type aggregates, warm-exports', async () => {
    const snapshots = new FakeSnapshotStore()
    const aggregates = new FakeAggregateStore()
    const audit = new InMemoryHighClassAuditSink()
    const warm = new InMemoryWarmTierExporter()
    const egress = fakeEgress(0)
    const { policy } = fastBackoff()
    const svc = new NebrasIngestionService({ egress, snapshots, aggregates, audit, warmExporter: warm, backoff: policy })

    const result = await svc.runIngestion(PERIOD, 'trace-1')

    expect(result.stale_sources).toBe(0)
    expect(result.sources.map((s) => s.outcome)).toEqual(['ingested', 'ingested'])
    // aggregate: 2 lines payment_settlement (500), 1 line lfi_access_log (50)
    const payment = aggregates.refreshed.find((a) => a.line_type === 'payment_settlement')!
    expect(payment.total_fee_minor).toBe(500)
    expect(payment.line_count).toBe(2)
    expect(result.aggregates_refreshed).toBe(2)
    // warm export ran for both snapshots
    expect(snapshots.exported).toHaveLength(2)
    expect(snapshots.exported[0]!.key).toMatch(/\.parquet$/)
    // idempotent run ids
    expect(snapshots.created.map((c) => c.run_id)).toEqual(['ingest-2026-05-tpp_reports', 'ingest-2026-05-dataset-consents'])
    // audit
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]!.event_type).toBe('nebras_ingestion_completed')
    expect(audit.events[0]!.response_status).toBe(200)
  })
})

describe('NebrasIngestionService — exponential back-off', () => {
  it('retries a rate-limited source with exponential delays then succeeds', async () => {
    const snapshots = new FakeSnapshotStore()
    const aggregates = new FakeAggregateStore()
    const egress = fakeEgress(2) // first 2 calls 429, 3rd ok
    const { policy, delays } = fastBackoff()
    const svc = new NebrasIngestionService({ egress, snapshots, aggregates, audit: new InMemoryHighClassAuditSink(), backoff: policy })

    const result = await svc.runIngestion(PERIOD, 'trace-2', [{ source: 'tpp_reports' }])

    expect(result.sources[0]!.outcome).toBe('ingested')
    expect(result.sources[0]!.attempts).toBe(3)
    expect(delays).toEqual([100, 200]) // base * 2^0, base * 2^1 — exponential
  })
})

describe('NebrasIngestionService — last-good fallback', () => {
  it('on exhausted back-off retains last-good + marks the period stale (amber)', async () => {
    const snapshots = new FakeSnapshotStore()
    snapshots.lastGood = { snapshot_id: 'snap-prev' }
    const aggregates = new FakeAggregateStore()
    const audit = new InMemoryHighClassAuditSink()
    const egress = fakeEgress(99) // always fails
    const { policy } = fastBackoff()
    const svc = new NebrasIngestionService({ egress, snapshots, aggregates, audit, backoff: policy })

    const result = await svc.runIngestion(PERIOD, 'trace-3', [{ source: 'tpp_reports' }])

    expect(result.sources[0]!.outcome).toBe('stale_fallback')
    expect(result.sources[0]!.attempts).toBe(4) // maxAttempts
    expect(result.sources[0]!.snapshot_id).toBe('snap-prev') // last-good retained
    expect(aggregates.staleCalls).toEqual([PERIOD])
    expect(result.stale_sources).toBe(1)
    expect(audit.events[0]!.response_status).toBe(207) // partial
    expect(egress.calls.tpp_reports).toBe(4) // all attempts spent
  })
})
