import { describe, expect, it } from 'vitest'
import { TppBehaviourProfiler, type TppActivitySource, type TppBehaviourSample, type TppDedupReader } from '../src/risk/tpp-profiling.js'

/**
 * BACKOFFICE-38 — TPP behavioural profiling: 3σ baseline deviations (volume,
 * hour-of-day, CoP mismatch) → a tpp_behaviour Risk signal, deduped across runs,
 * carrying the TPP client id (never PSU PII).
 */

class FakeSink {
  signals: { signal_type: string; severity: string; client_id?: string; dedup_key?: string; summary: string; context?: Record<string, unknown> }[] = []
  async record(e: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; client_id?: string; dedup_key?: string; context?: Record<string, unknown> }) {
    this.signals.push({ signal_type: e.signal_type, severity: e.severity, client_id: e.client_id, dedup_key: e.dedup_key, summary: e.summary, context: e.context })
  }
}

const source = (samples: TppBehaviourSample[]): TppActivitySource => ({ getTppActivity: async () => samples })
const dedup = (keys: string[] = []): TppDedupReader => ({ openAnomalyDedupKeys: async () => new Set(keys) })

describe('TppBehaviourProfiler', () => {
  it('flags a >3σ volume spike as a tpp_behaviour signal with the deviation context', async () => {
    const sink = new FakeSink()
    const det = new TppBehaviourProfiler({
      signals: sink,
      dedup: dedup(),
      source: source([{ client_id: 'tpp-1', display_name: 'Acme', metrics: { volume: { current: 5000, mean: 800, stddev: 120 } } }])
    })
    const out = await det.profile('t')
    expect(out[0]!.emitted).toBe(true)
    expect(sink.signals).toHaveLength(1)
    const s = sink.signals[0]!
    expect(s.signal_type).toBe('tpp_behaviour')
    expect(s.client_id).toBe('tpp-1')
    expect(s.dedup_key).toBe('tpp_behaviour|tpp-1')
    expect(s.severity).toBe('critical') // ~35σ ≫ band+2
    const devs = (s.context!.deviations as { metric: string }[])
    expect(devs.some((d) => d.metric === 'volume')).toBe(true)
  })

  it('does not flag metrics within the band, or a zero-stddev metric', async () => {
    const sink = new FakeSink()
    const det = new TppBehaviourProfiler({
      signals: sink,
      dedup: dedup(),
      source: source([
        { client_id: 'tpp-ok', metrics: { volume: { current: 1050, mean: 1000, stddev: 60 }, cop_mismatch: { current: 4, mean: 5, stddev: 2 } } },
        { client_id: 'tpp-flat', metrics: { volume: { current: 999, mean: 1000, stddev: 0 } } } // stddev 0 → never flagged
      ])
    })
    const out = await det.profile('t')
    expect(out.every((r) => !r.emitted)).toBe(true)
    expect(sink.signals).toHaveLength(0)
  })

  it('emits a single signal per TPP across multiple breaching metrics, severity by the worst z', async () => {
    const sink = new FakeSink()
    const det = new TppBehaviourProfiler({
      signals: sink,
      dedup: dedup(),
      source: source([{ client_id: 'tpp-2', metrics: { hour_of_day: { current: 95, mean: 10, stddev: 8 }, cop_mismatch: { current: 60, mean: 6, stddev: 4 } } }])
    })
    const out = await det.profile('t')
    expect(sink.signals).toHaveLength(1) // one signal, not one per metric
    expect((sink.signals[0]!.context!.deviations as unknown[]).length).toBe(2)
    expect(out[0]!.severity).toBe('critical')
  })

  it('dedups against open tpp_behaviour signals (no re-emit across runs)', async () => {
    const sink = new FakeSink()
    const det = new TppBehaviourProfiler({
      signals: sink,
      dedup: dedup(['tpp_behaviour|tpp-3']),
      source: source([{ client_id: 'tpp-3', metrics: { volume: { current: 9000, mean: 500, stddev: 100 } } }])
    })
    const out = await det.profile('t')
    expect(out[0]!.emitted).toBe(false)
    expect(sink.signals).toHaveLength(0)
  })

  it('honours a configurable sigma band', async () => {
    const sink = new FakeSink()
    // current is +2.5σ: not flagged at 3σ, flagged at 2σ
    const sample: TppBehaviourSample[] = [{ client_id: 'tpp-4', metrics: { volume: { current: 1250, mean: 1000, stddev: 100 } } }]
    expect((await new TppBehaviourProfiler({ signals: new FakeSink(), dedup: dedup(), source: source(sample), sigma: 3 }).profile('t'))[0]!.emitted).toBe(false)
    const det2 = new TppBehaviourProfiler({ signals: sink, dedup: dedup(), source: source(sample), sigma: 2 })
    expect((await det2.profile('t'))[0]!.emitted).toBe(true)
    expect(sink.signals).toHaveLength(1)
  })
})
