import { describe, expect, it } from 'vitest'
import { ConsentAnomalyDetector, type AnomalyDetectionReader } from '../src/risk/consent-anomaly.js'
import type { ConsentChurnRow, AgentLookupRow } from '@ofbo/db'

/**
 * BACKOFFICE-46 — ITSM ticket-raising for anomalous audit patterns: threshold-crossed
 * anomalies (PSU-lookup volume, repeated 403s, off-hours admin) → P3 ticket with team
 * routing; parallel paging for severity-critical.
 */

class FakeSink {
  signals: { signal_type: string; severity: string }[] = []
  async record(e: { signal_type: string; severity: string }) {
    this.signals.push({ signal_type: e.signal_type, severity: e.severity })
  }
}
class FakeItsm {
  tickets: { type: string; severity: string; team: string }[] = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push({ type: input.type, severity: input.severity, team: input.team })
    return { ticket_id: `tk-${this.tickets.length}` }
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

describe('BACKOFFICE-46 — anomaly ITSM escalation', () => {
  it('raises a team-routed ITSM ticket per emitted anomaly (Risk for lookups, Security for 403s/off-hours)', async () => {
    const itsm = new FakeItsm()
    const det = new ConsentAnomalyDetector({
      signals: new FakeSink(),
      itsm,
      detection: reader({
        lookupCountByAgent: async () => [{ agent: 'demo:a1', lookups: 150 }],
        scopeDenialsByAgent: async () => [{ agent: 'demo:a2', lookups: 12 }],
        offHoursAdminByAgent: async () => [{ agent: 'demo:a3', lookups: 20 }]
      })
    })
    const out = await det.detect('t')
    expect(out.filter((a) => a.emitted).length).toBe(3)
    const teams = itsm.tickets.filter((t) => t.type === 'audit_anomaly').map((t) => t.team).sort()
    expect(teams).toEqual(['risk', 'security', 'security']) // lookups→risk, 403s→security, off-hours→security
  })

  it('detects repeated 403s + off-hours admin as agent_anomaly', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({
      signals: sink,
      itsm: new FakeItsm(),
      detection: reader({ scopeDenialsByAgent: async () => [{ agent: 'demo:x', lookups: 11 }], offHoursAdminByAgent: async () => [{ agent: 'demo:y', lookups: 16 }] })
    })
    const out = await det.detect('t')
    expect(out.find((a) => a.rule === 'repeated_403s')!.emitted).toBe(true)
    expect(out.find((a) => a.rule === 'off_hours_admin')!.emitted).toBe(true)
    expect(sink.signals.every((s) => s.signal_type === 'agent_anomaly')).toBe(true)
  })

  it('parallel-pages on severity-critical (>3× threshold)', async () => {
    const itsm = new FakeItsm()
    const det = new ConsentAnomalyDetector({
      signals: new FakeSink(),
      itsm,
      detection: reader({ scopeDenialsByAgent: async () => [{ agent: 'demo:z', lookups: 40 }] }) // 40 > 3×10 → critical
    })
    const out = await det.detect('t')
    expect(out.find((a) => a.rule === 'repeated_403s')!.severity).toBe('critical')
    expect(out.find((a) => a.rule === 'repeated_403s')!.paged).toBe(true)
    expect(itsm.tickets.some((t) => t.type === 'audit_anomaly_page' && t.team === 'on_call' && t.severity === 'critical')).toBe(true)
  })

  it('without an ITSM port, anomalies still emit signals but raise no tickets (BACKOFFICE-37 posture)', async () => {
    const det = new ConsentAnomalyDetector({ signals: new FakeSink(), detection: reader({ scopeDenialsByAgent: async () => [{ agent: 'demo:x', lookups: 99 }] }) })
    const out = await det.detect('t')
    expect(out.find((a) => a.rule === 'repeated_403s')!.emitted).toBe(true)
    expect(out.find((a) => a.rule === 'repeated_403s')!.ticketed).toBe(false)
  })
})
