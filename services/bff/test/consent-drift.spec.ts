import { describe, expect, it } from 'vitest'
import { ConsentDriftMonitor, DemoConsentDriftSource, type WatchedConsent } from '../src/risk/consent-drift.js'

/**
 * DEMO-01 — consent-drift monitor. Emits a consent_anomaly signal when the Hub's reported status
 * disagrees with the platform mirror (the injected consent_drift fault), stays silent when they
 * agree, and dedups against open signals so re-runs don't duplicate.
 */

type Signal = { signal_type: string; severity: string; dedup_key?: string; context?: Record<string, unknown> }

function harness(hubStatusByConsent: Record<string, string>, watched: WatchedConsent[], openKeys: string[] = []) {
  const signals: Signal[] = []
  const egress = {
    async getConsentStatus(consentId: string) {
      return { consent_id: consentId, status: hubStatusByConsent[consentId] ?? 'Authorized' }
    }
  }
  const monitor = new ConsentDriftMonitor({
    egress,
    signals: { async record(e) { signals.push(e) } },
    source: { async watched() { return watched } },
    dedup: { async openAnomalyDedupKeys() { return new Set(openKeys) } }
  })
  return { monitor, signals }
}

describe('ConsentDriftMonitor', () => {
  it('emits a consent_anomaly signal when the Hub disagrees with the platform mirror', async () => {
    const { monitor, signals } = harness(
      { 'c-1': 'Authorized' }, // Hub says Authorized…
      [{ consent_id: 'c-1', expected_status: 'Revoked', psu_ref: 'hash-1' }] // …platform holds Revoked
    )
    const r = await monitor.detect('trace-1')
    expect(r).toMatchObject({ checked: 1, drifted: 1, emitted: 1 })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ signal_type: 'consent_anomaly', severity: 'high', dedup_key: 'consent_drift|c-1' })
    expect(signals[0]!.context).toMatchObject({ rule: 'consent_drift', hub_status: 'Authorized', expected_status: 'Revoked', consent_id: 'c-1', psu_ref: 'hash-1' })
  })

  it('stays silent when the Hub agrees with the mirror', async () => {
    const { monitor, signals } = harness(
      { 'c-1': 'Revoked' },
      [{ consent_id: 'c-1', expected_status: 'Revoked' }]
    )
    const r = await monitor.detect('trace-2')
    expect(r).toMatchObject({ checked: 1, drifted: 0, emitted: 0 })
    expect(signals).toHaveLength(0)
  })

  it('dedups against an already-open drift signal (no duplicate on re-run)', async () => {
    const { monitor, signals } = harness(
      { 'c-1': 'Authorized' },
      [{ consent_id: 'c-1', expected_status: 'Revoked' }],
      ['consent_drift|c-1']
    )
    const r = await monitor.detect('trace-3')
    expect(r).toMatchObject({ checked: 1, drifted: 1, emitted: 0 })
    expect(signals).toHaveLength(0)
  })

  it('DemoConsentDriftSource watches the dataset Revoked consents (expected Revoked, no PSU PII)', async () => {
    const watched = await new DemoConsentDriftSource().watched()
    expect(watched.length).toBeGreaterThan(0)
    expect(watched.every((w) => w.expected_status === 'Revoked')).toBe(true)
    // PSU refs are hashed (16 hex chars), never a raw cust-/Emirates-id.
    expect(watched.every((w) => /^[0-9a-f]{16}$/.test(w.psu_ref ?? ''))).toBe(true)
    expect(watched.some((w) => /784\d{12}/.test(w.consent_id))).toBe(false)
  })
})
