import { describe, expect, it } from 'vitest'
import { ConsentAnomalyDetector, type AnomalyDetectionReader } from '../src/risk/consent-anomaly.js'
import type { ConsentChurnRow, AgentLookupRow } from '@ofbo/db'

/**
 * BACKOFFICE-37 — streaming consent-pattern anomaly detection: consent churn >5×/24h
 * per PSU → consent_anomaly; >100 PSU lookups/agent/hour → agent_anomaly; session
 * flagged; deduped across runs; no raw PSU PII in the signal.
 */

class FakeSink {
  signals: { signal_type: string; severity: string; acting_principal: string; summary: string; dedup_key?: string; context?: Record<string, unknown> }[] = []
  async record(e: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; dedup_key?: string; context?: Record<string, unknown> }) {
    this.signals.push({ signal_type: e.signal_type, severity: e.severity, acting_principal: e.acting_principal, summary: e.summary, dedup_key: e.dedup_key, context: e.context })
  }
}

function reader(over: Partial<AnomalyDetectionReader> = {}): AnomalyDetectionReader {
  return {
    consentChurnByPsu: async (): Promise<ConsentChurnRow[]> => [],
    lookupCountByAgent: async (): Promise<AgentLookupRow[]> => [],
    scopeDenialsByAgent: async (): Promise<AgentLookupRow[]> => [],
    offHoursAdminByAgent: async (): Promise<AgentLookupRow[]> => [],
    openAnomalyDedupKeys: async () => new Set<string>(),
    ...over
  }
}

describe('ConsentAnomalyDetector', () => {
  it('flags a PSU with consent churn >5×/24h (consent_anomaly, session flagged, no raw PSU id)', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({
      signals: sink,
      detection: reader({ consentChurnByPsu: async () => [{ psu_identifier: 'BCID-PSU-001', revokes: 12, grants: 12, cycles: 12 }] })
    })
    const out = await det.detect('t')
    expect(out[0]!.emitted).toBe(true)
    expect(sink.signals).toHaveLength(1)
    const s = sink.signals[0]!
    expect(s.signal_type).toBe('consent_anomaly')
    expect(s.severity).toBe('high') // 12 > 2×5
    expect(s.context!.session_flagged).toBe(true)
    expect(s.context!.churn_cycles).toBe(12)
    // no raw PSU identifier leaks — only a hashed ref
    expect(s.summary).not.toContain('BCID-PSU-001')
    expect(JSON.stringify(s)).not.toContain('BCID-PSU-001')
    expect(s.dedup_key).toMatch(/^consent_churn\|[0-9a-f]{16}$/)
  })

  it('does not flag churn at or below the threshold', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({ signals: sink, detection: reader({ consentChurnByPsu: async () => [{ psu_identifier: 'p', revokes: 5, grants: 5, cycles: 5 }] }) })
    await det.detect('t')
    expect(sink.signals).toHaveLength(0) // 5 is not > 5
  })

  it('flags an agent with >100 PSU lookups/hour (agent_anomaly)', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({ signals: sink, detection: reader({ lookupCountByAgent: async () => [{ agent: 'demo:customer-care-agent', lookups: 142 }] }) })
    const out = await det.detect('t')
    expect(out[0]!.emitted).toBe(true)
    const s = sink.signals[0]!
    expect(s.signal_type).toBe('agent_anomaly')
    expect(s.acting_principal).toBe('demo:customer-care-agent')
    expect(s.context!.lookup_count).toBe(142)
    expect(s.dedup_key).toBe('agent_lookups|demo:customer-care-agent')
  })

  it('dedups against open anomaly signals (no re-emit across runs)', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({
      signals: sink,
      detection: reader({
        lookupCountByAgent: async () => [{ agent: 'demo:agent-x', lookups: 200 }],
        openAnomalyDedupKeys: async () => new Set(['agent_lookups|demo:agent-x'])
      })
    })
    const out = await det.detect('t')
    expect(out[0]!.emitted).toBe(false)
    expect(sink.signals).toHaveLength(0)
  })

  it('honours configurable thresholds', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({ signals: sink, detection: reader({ lookupCountByAgent: async () => [{ agent: 'a', lookups: 50 }] }), thresholds: { lookups_per_agent_1h: 40 } })
    await det.detect('t')
    expect(sink.signals).toHaveLength(1) // 50 > 40
  })
})
