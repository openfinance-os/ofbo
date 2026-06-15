/**
 * BACKOFFICE-38 — TPP behavioural profiling. A headless profiler that compares each
 * consuming TPP's current behaviour against its own rolling baseline (mean + stddev)
 * across three dimensions — request VOLUME, HOUR-OF-DAY concentration, and CoP
 * mismatch rate — and emits a `tpp_behaviour` Risk signal when a metric deviates
 * beyond the configurable sigma band (default 3σ). One signal per TPP per run,
 * deduped across runs by a key in signal_data; the existing Risk View surfaces the
 * tpp_behaviour count. The TPP subject is an organisation/client id, never PSU PII.
 */

export const DEFAULT_SIGMA = 3

export type TppMetricKey = 'volume' | 'hour_of_day' | 'cop_mismatch'

/** A metric's current value vs the TPP's rolling baseline. */
export interface TppMetricStat {
  current: number
  mean: number
  stddev: number
}

export interface TppBehaviourSample {
  client_id: string
  display_name?: string
  metrics: Partial<Record<TppMetricKey, TppMetricStat>>
}

export interface TppActivitySource {
  getTppActivity(): Promise<TppBehaviourSample[]>
}

export interface TppBehaviourSink {
  record(event: {
    signal_type: string
    severity: string
    acting_principal: string
    summary: string
    trace_id: string
    client_id?: string
    dedup_key?: string
    context?: Record<string, unknown>
  }): Promise<void>
}

export interface TppDedupReader {
  openAnomalyDedupKeys(): Promise<Set<string>>
}

export interface TppBehaviourProfilerDeps {
  source: TppActivitySource
  signals: TppBehaviourSink
  dedup: TppDedupReader
  /** Deviation band in standard deviations (default 3σ). */
  sigma?: number
  now?: () => Date
}

export interface TppDeviation {
  metric: TppMetricKey
  current: number
  mean: number
  stddev: number
  z: number
}

export interface TppProfileResult {
  client_id: string
  deviations: TppDeviation[]
  severity: string
  emitted: boolean
}

const RUN_PRINCIPAL = 'system:tpp-behaviour-profiler'
const METRIC_LABEL: Record<TppMetricKey, string> = {
  volume: 'request volume',
  hour_of_day: 'off-baseline hour-of-day activity',
  cop_mismatch: 'CoP mismatch rate'
}

/** Severity scales with how far the worst metric exceeds the band. */
function severityForMaxZ(maxZ: number, sigma: number): 'medium' | 'high' | 'critical' {
  if (maxZ >= sigma + 2) return 'critical'
  if (maxZ >= sigma + 1) return 'high'
  return 'medium'
}

export class TppBehaviourProfiler {
  private readonly sigma: number
  constructor(private readonly deps: TppBehaviourProfilerDeps) {
    this.sigma = deps.sigma ?? DEFAULT_SIGMA
  }

  async profile(traceId: string): Promise<TppProfileResult[]> {
    const openKeys = await this.deps.dedup.openAnomalyDedupKeys()
    const samples = await this.deps.source.getTppActivity()
    const out: TppProfileResult[] = []

    for (const tpp of samples) {
      const deviations: TppDeviation[] = []
      for (const key of Object.keys(tpp.metrics) as TppMetricKey[]) {
        const stat = tpp.metrics[key]
        if (!stat || stat.stddev <= 0) continue
        const z = (stat.current - stat.mean) / stat.stddev
        if (z > this.sigma) deviations.push({ metric: key, current: stat.current, mean: stat.mean, stddev: stat.stddev, z })
      }
      const dedupKey = `tpp_behaviour|${tpp.client_id}`
      if (deviations.length === 0 || openKeys.has(dedupKey)) {
        out.push({ client_id: tpp.client_id, deviations, severity: 'none', emitted: false })
        continue
      }
      const maxZ = Math.max(...deviations.map((d) => d.z))
      const severity = severityForMaxZ(maxZ, this.sigma)
      const label = deviations.map((d) => METRIC_LABEL[d.metric]).join(', ')
      await this.deps.signals.record({
        signal_type: 'tpp_behaviour',
        severity,
        acting_principal: RUN_PRINCIPAL,
        summary: `TPP behavioural deviation (>${this.sigma}σ): ${label} for ${tpp.display_name ?? tpp.client_id}`,
        trace_id: traceId,
        client_id: tpp.client_id,
        dedup_key: dedupKey,
        context: { deviations: deviations.map((d) => ({ ...d, z: Number(d.z.toFixed(2)) })), display_name: tpp.display_name ?? null }
      })
      openKeys.add(dedupKey)
      out.push({ client_id: tpp.client_id, deviations, severity, emitted: true })
    }
    return out
  }
}

/**
 * Deterministic demo TPP activity. Two well-behaved TPPs (within band) and two with
 * clear >3σ deviations — a volume spike and an off-hours + CoP-mismatch combo — so the
 * demo can show the profiler firing tpp_behaviour signals on cue.
 */
export class DemoTppActivitySource implements TppActivitySource {
  async getTppActivity(): Promise<TppBehaviourSample[]> {
    return [
      { client_id: '00000000-0000-4000-8000-0000000000a1', display_name: 'Acme Aggregator', metrics: { volume: { current: 1050, mean: 1000, stddev: 60 }, hour_of_day: { current: 3, mean: 2, stddev: 2 }, cop_mismatch: { current: 4, mean: 5, stddev: 2 } } },
      { client_id: '00000000-0000-4000-8000-0000000000a2', display_name: 'Beacon PISP', metrics: { volume: { current: 480, mean: 500, stddev: 40 }, cop_mismatch: { current: 2, mean: 3, stddev: 1.5 } } },
      { client_id: '00000000-0000-4000-8000-0000000000a3', display_name: 'Cirrus Data', metrics: { volume: { current: 5200, mean: 800, stddev: 120 } } }, // ~36σ volume spike
      { client_id: '00000000-0000-4000-8000-0000000000a4', display_name: 'Delta Money', metrics: { hour_of_day: { current: 95, mean: 10, stddev: 8 }, cop_mismatch: { current: 60, mean: 6, stddev: 4 } } } // off-hours + CoP spike
    ]
  }
}
