import type { ApmPort, NebrasEgressPort, OtelSpan } from '@ofbo/ports'
import type { HighClassAuditSink } from '../high-class-audit.js'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '@ofbo/db'

/**
 * BACKOFFICE-32 — Nebras TPP Reports + Dataset ingestion. A headless scheduled
 * job (no public ingress): polls the Hub surfaces via the P6 egress adapter (all
 * Nebras-bound traffic — non-negotiable) with EXPONENTIAL BACK-OFF on rate-limit/
 * transient errors, lands each snapshot to the hot store, writes the columnar warm
 * copy through the warm-tier exporter (Parquet → object storage at M6; the demo
 * sink stands in — no object storage provisioned), and refreshes the materialized
 * aggregates the M4 analytics views read. On exhausted failure the previous
 * aggregates are retained and flagged stale (amber freshness) — the last-good
 * fallback. Synthetic Nebras data only; no PSU PII.
 */

export interface SnapshotRow {
  snapshot_id: string
  source: string
  period: string
  rows: Record<string, unknown>[]
}

export interface NebrasSnapshotSink {
  create(
    input: { source: 'tpp_reports' | 'dataset'; dataset_name?: string | null; period: string; run_id: string; published_at: string; rows: Record<string, unknown>[] },
    traceId: string
  ): Promise<{ snapshot: SnapshotRow; created: boolean }>
  markWarmExported(snapshotId: string, objectKey: string, traceId: string): Promise<unknown>
  latestGood(source: string, period: string, datasetName?: string | null): Promise<{ snapshot_id: string } | null>
}

export interface NebrasAggregateSink {
  refresh(
    inputs: { period: string; channel: string; line_type: string; total_fee_minor: number; line_count: number; currency: string; source_published_at: string }[],
    traceId: string
  ): Promise<unknown[]>
  markStale(period: string, traceId: string): Promise<number>
}

/** The warm tier (Parquet on object storage). The demo sink keeps the columnar
 *  copy in memory (no object storage provisioned, BD-14); the enterprise adapter
 *  (M6) writes Parquet to R2/S3. Returning null = warm export skipped. */
export interface WarmTierExporter {
  export(snapshot: SnapshotRow): Promise<{ object_key: string } | null>
}


export interface BackoffPolicy {
  maxAttempts: number
  baseDelayMs: number
  sleep: (ms: number) => Promise<void>
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface IngestionTarget {
  source: 'tpp_reports' | 'dataset'
  dataset_name?: string
}

export const DEFAULT_TARGETS: IngestionTarget[] = [
  { source: 'tpp_reports' },
  { source: 'dataset', dataset_name: 'consents' }
]

export interface SourceResult {
  source: string
  dataset_name: string | null
  outcome: 'ingested' | 'stale_fallback'
  attempts: number
  row_count: number
  snapshot_id: string | null
}

export interface IngestionRunResult {
  period: string
  sources: SourceResult[]
  aggregates_refreshed: number
  stale_sources: number
}

export interface NebrasIngestionDeps {
  egress: Pick<NebrasEgressPort, 'fetchTppReports' | 'fetchDataset'>
  snapshots: NebrasSnapshotSink
  aggregates: NebrasAggregateSink
  audit: HighClassAuditSink
  warmExporter?: WarmTierExporter
  apm?: Pick<ApmPort, 'exportSpans'>
  backoff?: Partial<BackoffPolicy>
}

const RUN_PRINCIPAL = 'system:nebras-ingestion'
const RUN_PERSONA = 'system'

interface Fee {
  amount: number
  currency: string
}

/** Materialized aggregate: per (channel, line_type) fee total + line count. */
function aggregateTppReports(period: string, publishedAt: string, rows: Record<string, unknown>[]) {
  const buckets = new Map<string, { channel: string; line_type: string; total_fee_minor: number; line_count: number; currency: string }>()
  for (const row of rows) {
    const channel = String(row.channel ?? 'internal_retail')
    const lineType = String(row.line_type ?? 'unknown')
    const fee = (row.fee as Fee | undefined) ?? { amount: 0, currency: 'AED' }
    const key = `${channel}|${lineType}`
    const b = buckets.get(key) ?? { channel, line_type: lineType, total_fee_minor: 0, line_count: 0, currency: fee.currency || 'AED' }
    b.total_fee_minor += Math.trunc(fee.amount) || 0
    b.line_count += 1
    buckets.set(key, b)
  }
  return [...buckets.values()].map((b) => ({ period, source_published_at: publishedAt, ...b }))
}

export class NebrasIngestionService {
  private readonly deps: NebrasIngestionDeps
  private readonly policy: BackoffPolicy
  constructor(deps: NebrasIngestionDeps) {
    this.deps = deps
    this.policy = { maxAttempts: deps.backoff?.maxAttempts ?? 4, baseDelayMs: deps.backoff?.baseDelayMs ?? 200, sleep: deps.backoff?.sleep ?? DEFAULT_SLEEP }
  }

  /** Poll with exponential back-off; throws once attempts are exhausted. */
  private async withBackoff<T>(fn: () => Promise<T>): Promise<{ value: T; attempts: number }> {
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        return { value: await fn(), attempts: attempt }
      } catch (e) {
        if (attempt >= this.policy.maxAttempts) throw e
        await this.policy.sleep(this.policy.baseDelayMs * 2 ** (attempt - 1))
      }
    }
  }

  async runIngestion(period: string, trace: string, targets: IngestionTarget[] = DEFAULT_TARGETS): Promise<IngestionRunResult> {
    const spans: OtelSpan[] = []
    const runStart = performance.now()
    const sources: SourceResult[] = []
    let aggregatesRefreshed = 0

    for (const target of targets) {
      const datasetName = target.dataset_name ?? null
      const runId = `ingest-${period}-${target.source}${datasetName ? `-${datasetName}` : ''}`
      const start = performance.now()
      try {
        const { value: fetched, attempts } = await this.withBackoff(() =>
          target.source === 'tpp_reports'
            ? this.deps.egress.fetchTppReports(period, { trace_id: trace })
            : this.deps.egress.fetchDataset(datasetName!, period, { trace_id: trace })
        )
        const { snapshot } = await this.deps.snapshots.create(
          { source: target.source, dataset_name: datasetName, period, run_id: runId, published_at: fetched.published_at, rows: fetched.rows },
          trace
        )
        if (this.deps.warmExporter) {
          const exported = await this.deps.warmExporter.export(snapshot)
          if (exported) await this.deps.snapshots.markWarmExported(snapshot.snapshot_id, exported.object_key, trace)
        }
        if (target.source === 'tpp_reports') {
          const aggs = aggregateTppReports(period, fetched.published_at, fetched.rows)
          await this.deps.aggregates.refresh(aggs, trace)
          aggregatesRefreshed += aggs.length
        }
        sources.push({ source: target.source, dataset_name: datasetName, outcome: 'ingested', attempts, row_count: fetched.rows.length, snapshot_id: snapshot.snapshot_id })
        spans.push(this.span(`nebras.ingest.${target.source}`, trace, start, 'ok', { source: target.source, period, attempts, row_count: fetched.rows.length }))
      } catch {
        // Back-off exhausted — retain the last-good snapshot, flag the period stale.
        await this.deps.aggregates.markStale(period, trace)
        const lastGood = await this.deps.snapshots.latestGood(target.source, period, datasetName)
        sources.push({ source: target.source, dataset_name: datasetName, outcome: 'stale_fallback', attempts: this.policy.maxAttempts, row_count: 0, snapshot_id: lastGood?.snapshot_id ?? null })
        spans.push(this.span(`nebras.ingest.${target.source}`, trace, start, 'error', { source: target.source, period, outcome: 'stale_fallback' }))
      }
    }

    const staleSources = sources.filter((s) => s.outcome === 'stale_fallback').length
    spans.unshift(this.span('nebras.ingestion.run', trace, runStart, staleSources === 0 ? 'ok' : 'error', { period, sources: sources.length, stale_sources: staleSources }))
    if (this.deps.apm) void Promise.resolve(this.deps.apm.exportSpans(spans)).catch(() => undefined)

    await this.deps.audit.emit({
      event_type: 'nebras_ingestion_completed',
      acting_principal: RUN_PRINCIPAL,
      acting_persona: RUN_PERSONA,
      // CODE-03. This borrowed `reconciliation:read` — a DECLARED scope, held by a human persona,
      // that no principal held on this run. It survived the first sweep because the resolvability
      // check only asks whether a value resolves against the route table, and a borrowed real scope
      // resolves perfectly. Borrowing is the harder half of the defect: an invented token at least
      // looks wrong to an auditor, whereas this reads as though a Finance persona authorised a
      // scheduled job.
      scope_used: SYSTEM_ACTOR_SCOPE,
      request_trace_id: trace,
      request_body: { period, sources: sources.map((s) => ({ source: s.source, dataset_name: s.dataset_name, outcome: s.outcome, attempts: s.attempts })), aggregates_refreshed: aggregatesRefreshed },
      // No HTTP response is issued by a scheduled run, so neither 200 nor 207 was ever returned to
      // anyone. The stale-source count they encoded is not lost: every source's outcome is in
      // `request_body.sources` above, which is where an auditor would look for it anyway.
      response_status: SYSTEM_ACTOR_RESPONSE_STATUS
    })

    return { period, sources, aggregates_refreshed: aggregatesRefreshed, stale_sources: staleSources }
  }

  private span(name: string, trace: string, start: number, status: 'ok' | 'error', attributes: Record<string, string | number | boolean>): OtelSpan {
    return { name, trace_id: trace, span_id: crypto.randomUUID(), start_time: start, end_time: performance.now(), status_code: status, attributes }
  }
}

// CODE-02 — in-memory store(s) moved to services/bff/memory/analytics-ingestion.ts (demo-profile production
// defaults, not test fixtures). Re-exported so every existing import is unchanged.
export {
  InMemoryWarmTierExporter
} from '../../memory/analytics-ingestion.js'
