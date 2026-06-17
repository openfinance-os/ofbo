import { describe, expect, it } from 'vitest'
import type { ConsentChurnRow, AgentLookupRow } from '@ofbo/db'
import { CaapRegistrationRecorder, DemoCaapEventSource } from '../src/risk/caap-audit.js'
import { ConsentAnomalyDetector, type AnomalyDetectionReader } from '../src/risk/consent-anomaly.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'

/**
 * BACKOFFICE-69 — CAAP registration/deregistration audit + streaming anomaly watch
 * (>10 registrations/device/hour → agent_anomaly). No bank PSU PII (device + opaque
 * caap_user_ref; body redacted at emission).
 */

class FakeSink {
  signals: { signal_type: string; acting_principal: string; dedup_key?: string; severity: string; context?: Record<string, unknown> }[] = []
  async record(e: { signal_type: string; acting_principal: string; dedup_key?: string; severity: string; context?: Record<string, unknown>; summary: string; trace_id: string }) {
    this.signals.push({ signal_type: e.signal_type, acting_principal: e.acting_principal, dedup_key: e.dedup_key, severity: e.severity, context: e.context })
  }
}

function reader(over: Partial<AnomalyDetectionReader> = {}): AnomalyDetectionReader {
  return {
    consentChurnByPsu: async (): Promise<ConsentChurnRow[]> => [],
    lookupCountByAgent: async (): Promise<AgentLookupRow[]> => [],
    scopeDenialsByAgent: async (): Promise<AgentLookupRow[]> => [],
    offHoursAdminByAgent: async (): Promise<AgentLookupRow[]> => [],
    caapRegistrationsByDevice: async (): Promise<AgentLookupRow[]> => [],
    openAnomalyDedupKeys: async () => new Set<string>(),
    ...over
  }
}

describe('CaapRegistrationRecorder', () => {
  it('records one High-class audit per event (device as acting principal, no PSU PII)', async () => {
    const audit = new InMemoryHighClassAuditSink()
    const out = await new CaapRegistrationRecorder({ audit }).record(
      [
        { device_ref: 'device:1', caap_user_ref: 'caap-user-x', action: 'register' },
        { device_ref: 'device:1', caap_user_ref: 'caap-user-x', action: 'deregister' }
      ],
      't'
    )
    expect(out.map((r) => r.event_type)).toEqual(['caap_registered', 'caap_deregistered'])
    expect(audit.events).toHaveLength(2)
    expect(audit.events[0]).toMatchObject({ event_type: 'caap_registered', acting_principal: 'device:1', acting_persona: 'caap' })
    // no bank PSU identifier / Emirates ID in the audit
    expect(JSON.stringify(audit.events)).not.toMatch(/\b784-?\d/)
  })
})

describe('CAAP registration anomaly (>10/device/hour → agent_anomaly)', () => {
  it('flags a device with >10 registrations in the hour', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({ signals: sink, detection: reader({ caapRegistrationsByDevice: async () => [{ agent: 'device:spike', lookups: 12 }] }) })
    const out = await det.detect('t')
    const caap = out.find((a) => a.rule === 'caap_registration')!
    expect(caap.emitted).toBe(true)
    const s = sink.signals[0]!
    expect(s.signal_type).toBe('agent_anomaly')
    expect(s.acting_principal).toBe('device:spike')
    expect(s.dedup_key).toBe('caap_registration|device:spike')
    expect(s.context!.rule).toBe('caap_registration_spike')
    expect(s.context!.caap_registration_count).toBe(12)
  })

  it('does not flag a device at or below the threshold (10)', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({ signals: sink, detection: reader({ caapRegistrationsByDevice: async () => [{ agent: 'device:ok', lookups: 10 }] }) })
    await det.detect('t')
    expect(sink.signals).toHaveLength(0)
  })

  it('dedups against open caap_registration signals', async () => {
    const sink = new FakeSink()
    const det = new ConsentAnomalyDetector({
      signals: sink,
      detection: reader({ caapRegistrationsByDevice: async () => [{ agent: 'device:z', lookups: 50 }], openAnomalyDedupKeys: async () => new Set(['caap_registration|device:z']) })
    })
    const out = await det.detect('t')
    expect(out.find((a) => a.rule === 'caap_registration')!.emitted).toBe(false)
    expect(sink.signals).toHaveLength(0)
  })

  it('DemoCaapEventSource includes a device with a >10 registration spike', async () => {
    const events = await new DemoCaapEventSource().getEvents()
    const registrations = events.filter((e) => e.action === 'register' && e.device_ref === 'device:spike-9')
    expect(registrations.length).toBeGreaterThan(10)
  })
})
