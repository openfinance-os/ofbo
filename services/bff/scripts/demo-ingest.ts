import {
  PgAuditEmitter,
  PgLineageEmitter,
  PgNebrasSnapshotStore,
  PgNebrasAggregateStore,
  PgRiskSignalEmitter,
  PgRiskMetricsStore,
  PgAnomalyDetectionStore
} from '@ofbo/db'
import { getAdapter } from '@ofbo/ports'
import { NebrasIngestionService, InMemoryWarmTierExporter } from '../src/analytics/ingestion.js'
import { LiabilityMonitorService, DemoLiabilityEventSource } from '../src/risk/liability.js'
import { LiabilityForecastMonitor, DemoLiabilityTelemetrySource } from '../src/risk/liability-forecast.js'
import { ConsentAnomalyDetector } from '../src/risk/consent-anomaly.js'
import { TppBehaviourProfiler, DemoTppActivitySource } from '../src/risk/tpp-profiling.js'

/**
 * Demo helper: run the headless ingestion + risk-monitor pass ON DEMAND — the same work the
 * scheduled() Worker job does, against the demo DB. This is the on-stage cause→effect lever for
 * the Nebras `/admin/faults` injections: a `fee_variance` / `report_rate_limit` fault only
 * surfaces once ingestion pulls the perturbed TPP report via the P6 egress port and refreshes
 * the analytics aggregates the Finance View reads. It ALSO runs the liability / anomaly / TPP /
 * forecast monitors so risk signals appear on demand (deduped against open signals).
 *
 * The recon/analytics engines are headless, no-public-ingress jobs (CLAUDE.md) — so this is a
 * CLI lever (like demo:break), NOT an HTTP route. Synthetic + non-prod. NOT wired into deploy.
 * Reads the Nebras sim through the SAME P6 adapter the BFF uses (NEBRAS_SIM_URL), so it must
 * point at the sim where you injected the fault.
 *
 *   pnpm demo:fault fee-variance 2026-06 999   # inject (against the sim)
 *   pnpm demo:ingest 2026-06                    # pull it in → Finance View freshness/aggregate
 *   pnpm demo:ingest                            # default: current month; also refreshes signals
 */
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const tenancy = {
  bankId: process.env.BANK_ID ?? '11111111-1111-4111-8111-111111111111',
  channel: 'internal_retail'
}
const period = process.argv[2] ?? new Date().toISOString().slice(0, 7)
const trace = crypto.randomUUID()

const lineage = new PgLineageEmitter(url, tenancy)
const audit = new PgAuditEmitter(url, tenancy, lineage)
const snapshots = new PgNebrasSnapshotStore(url, tenancy, lineage)
const aggregates = new PgNebrasAggregateStore(url, tenancy, lineage)
const riskSignals = new PgRiskSignalEmitter(url, tenancy, lineage)
const riskMetrics = new PgRiskMetricsStore(url, tenancy)
const anomalyStore = new PgAnomalyDetectionStore(url, tenancy)
const egress = getAdapter('p6-nebras-egress', 'demo')
const apm = getAdapter('p5-apm', 'demo')
const itsm = getAdapter('p3-itsm', 'demo')

const ingestion = new NebrasIngestionService({ egress, snapshots, aggregates, audit, apm, warmExporter: new InMemoryWarmTierExporter() })
const liabilityMonitor = new LiabilityMonitorService({ signals: riskSignals, itsm })
const anomalyDetector = new ConsentAnomalyDetector({ detection: anomalyStore, signals: riskSignals, itsm })
const tppProfiler = new TppBehaviourProfiler({ source: new DemoTppActivitySource(), signals: riskSignals, dedup: anomalyStore })
const forecastMonitor = new LiabilityForecastMonitor({ telemetry: new DemoLiabilityTelemetrySource(), signals: riskSignals, itsm })

const openLiabilityRefs = async () => {
  const open = await riskMetrics.liabilityMonitor()
  return new Set(open.recent.map((s) => s.nebras_liability_event_ref).filter((r): r is string => !!r))
}

try {
  // 1. Ingestion — pulls the (possibly fault-perturbed) TPP report via P6 and refreshes aggregates.
  const result = await ingestion.runIngestion(period, trace)
  // 2. Risk monitors — emit signals on demand (deduped against currently-open signals).
  await liabilityMonitor.evaluate(await new DemoLiabilityEventSource().getLiabilityEvents(), await openLiabilityRefs(), trace)
  await anomalyDetector.detect(trace)
  await tppProfiler.profile(trace)
  await forecastMonitor.run(trace, await openLiabilityRefs())

  console.log(
    `On-demand ingestion for ${period}: ${result.sources.length} source(s), ` +
      `${result.aggregates_refreshed} aggregate(s) refreshed, ${result.stale_sources} stale; risk monitors run.`
  )
  console.log('→ refresh the Finance View (freshness/aggregates) and the Risk view (signals). Inject a fault first with `pnpm demo:fault` to see it land.')
} finally {
  await Promise.all([
    snapshots.close(),
    aggregates.close(),
    riskSignals.close(),
    riskMetrics.close(),
    anomalyStore.close(),
    audit.close(),
    lineage.close()
  ])
}
