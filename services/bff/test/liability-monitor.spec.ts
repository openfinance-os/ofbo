import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { LiabilityMonitorService, LiabilityViewService, liabilityAmount, LIABILITY_MATRIX, type LiabilityEvent } from '../src/risk/liability.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-36 — proactive Nebras-liability monitor: v2.1 matrix, threshold-crossing
 * nebras_liability_approach signal + P3 ITSM to Risk AND Ops (deduped), read view.
 */

const risk: Principal = { subject: 'demo:risk', persona: 'risk-analyst', scopes: ['risk:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

class FakeSink {
  signals: { signal_type: string; severity: string; nebras_liability_event_ref?: string }[] = []
  async record(e: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; nebras_liability_event_ref?: string }) {
    this.signals.push({ signal_type: e.signal_type, severity: e.severity, nebras_liability_event_ref: e.nebras_liability_event_ref })
  }
}
class FakeItsm {
  tickets: { team: string; severity: string; type: string }[] = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push({ team: input.team, severity: input.severity, type: input.type })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

describe('LiabilityMonitorService — matrix + threshold evaluation', () => {
  it('maps issues to v2.1 AED amounts (incl. SLA tiers)', () => {
    expect(liabilityAmount({ issue: 'fraud_prevention_failure' })).toBe(10000)
    expect(liabilityAmount({ issue: 'lfi_breaking_change' })).toBe(5000)
    expect(liabilityAmount({ issue: 'sla_execution_failure', sla_tier: 2 })).toBe(250)
    expect(LIABILITY_MATRIX.consent_state_failure).toBe(500)
  })

  it('emits a signal + ITSM to Risk AND Ops when an event crosses its threshold', async () => {
    const sink = new FakeSink()
    const itsm = new FakeItsm()
    const svc = new LiabilityMonitorService({ signals: sink, itsm })
    const events: LiabilityEvent[] = [{ issue: 'fraud_prevention_failure', liable_party: 'TPP', incident_count: 1 }]
    const out = await svc.evaluate(events, new Set(), 't')
    expect(out[0]!.emitted).toBe(true)
    expect(out[0]!.severity).toBe('critical') // 10000 AED
    expect(out[0]!.ref).toBe('fraud_prevention_failure|TPP|10000')
    expect(sink.signals).toHaveLength(1)
    expect(sink.signals[0]!.signal_type).toBe('nebras_liability_approach')
    expect(itsm.tickets.map((t) => t.team).sort()).toEqual(['payment_operations', 'risk'])
  })

  it('dedups against already-open liability signals (no re-emit)', async () => {
    const sink = new FakeSink()
    const itsm = new FakeItsm()
    const svc = new LiabilityMonitorService({ signals: sink, itsm })
    const events: LiabilityEvent[] = [{ issue: 'consent_state_failure', liable_party: 'LFI', incident_count: 1 }]
    const out = await svc.evaluate(events, new Set(['consent_state_failure|LFI|500']), 't')
    expect(out[0]!.emitted).toBe(false)
    expect(sink.signals).toHaveLength(0)
    expect(itsm.tickets).toHaveLength(0)
  })

  it('does not emit below the configurable per-class threshold', async () => {
    const sink = new FakeSink()
    const svc = new LiabilityMonitorService({ signals: sink, itsm: new FakeItsm(), thresholds: { consent_state_failure: 2000 } })
    const out = await svc.evaluate([{ issue: 'consent_state_failure', liable_party: 'LFI', incident_count: 1 }], new Set(), 't') // 500 < 2000
    expect(out[0]!.emitted).toBe(false)
  })
})

describe('LiabilityViewService — read view', () => {
  const reader = {
    liabilityMonitor: async () => ({ open_count: 2, by_severity: { critical: 1, medium: 1 }, recent: [
      { nebras_liability_event_ref: 'fraud_prevention_failure|TPP|10000', severity: 'critical', created_at: '2026-06-15T09:00:00.000Z' },
      { nebras_liability_event_ref: 'consent_state_failure|LFI|500', severity: 'medium', created_at: '2026-06-15T08:00:00.000Z' }
    ] })
  }

  it('composes the matrix + open signals into approaching triggers', async () => {
    const { data, freshness } = await new LiabilityViewService({ riskMetrics: reader }).view(risk)
    expect((data.liability_matrix as { per_incident_aed: Record<string, number> }).per_incident_aed.fraud_prevention_failure).toBe(10000)
    expect(data.open_count).toBe(2)
    const triggers = data.approaching_triggers as { issue: string; liable_party: string; accrued_aed: number }[]
    expect(triggers).toHaveLength(2)
    expect(triggers[0]).toMatchObject({ issue: 'fraud_prevention_failure', liable_party: 'TPP', accrued_aed: 10000 })
    expect(freshness.stale).toBe(false)
  })

  it('UIF-04: emits typed sections (liability-by-severity bars + approaching-triggers table)', async () => {
    const { data } = await new LiabilityViewService({ riskMetrics: reader }).view(risk)
    const sections = data.sections as { kind: string; segments?: { label: string; value: number }[]; table?: { columns: string[]; rows: unknown[] } }[]
    const bars = sections.find((s) => s.kind === 'contribution-bars')
    expect(bars?.segments?.map((g) => g.label).sort()).toEqual(['critical', 'medium'])
    const table = sections.find((s) => s.kind === 'object-table')
    expect(table?.table?.rows).toHaveLength(2)
    expect(table?.table?.columns).toContain('accrued_aed')
  })

  it('rejects a principal without risk:read', async () => {
    await expect(new LiabilityViewService({ riskMetrics: reader }).view(care)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/nebras-liability-monitor (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the matrix for risk-analyst', async () => {
    const res = await app.request('/back-office/analytics/nebras-liability-monitor', { headers: auth('risk-analyst') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { liability_matrix: unknown }; freshness: { stale: boolean } }
    expect(body.data).toHaveProperty('liability_matrix')
    expect(body.data).toHaveProperty('approaching_triggers')
  })

  it('rejects a wrong-scope persona (403)', async () => {
    const res = await app.request('/back-office/analytics/nebras-liability-monitor', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})

/**
 * STD-09 — an unmodelled liability class must RAISE, not silently accrue nothing.
 *
 * `liabilityAmount` returned 0 for any issue absent from the v2.1 matrix, and the threshold derives
 * from THE SAME lookup — so both sides were 0, `accrued >= threshold` was `0 >= 0`, and the class
 * crossed on its first incident.
 *
 * It did not go quiet, which is what makes this worse than a missed signal. It emitted a
 * `nebras_liability_approach` signal plus two P3 ITSM tickets reporting the bank's exposure as
 * AED 0 at low severity — a queue that looks like it is working, on a class nobody has priced.
 * Silence gets investigated; a confident zero does not.
 */
describe('STD-09 — an unmodelled liability class fails loud', () => {
  it('refuses to price an issue the matrix does not model', () => {
    expect(() => liabilityAmount({ issue: 'not_a_modelled_class' }))
      .toThrow(/not_a_modelled_class/)
  })

  it('still prices every class the scheme does model', () => {
    for (const [issue, aed] of Object.entries(LIABILITY_MATRIX)) {
      if (issue === 'sla_execution_failure') continue // tiered — asserted separately
      expect(liabilityAmount({ issue })).toBe(aed)
    }
  })

  it('never emits an AED 0 signal for an unpriced class', async () => {
    const sink = new FakeSink()
    const itsm = new FakeItsm()
    const svc = new LiabilityMonitorService({ signals: sink, itsm })
    const events: LiabilityEvent[] = [{ issue: 'brand_new_scheme_class', liable_party: 'LFI', incident_count: 1 }]

    await expect(svc.evaluate(events, new Set(), 'trace-std09')).rejects.toThrow(/brand_new_scheme_class/)
    // And nothing was emitted on the way out — no half-written queue of zero-value alerts.
    expect(sink.signals).toHaveLength(0)
    expect(itsm.tickets).toHaveLength(0)
  })

  /**
   * The scheme's international-payment new-beneficiary breach. The AED 15,000 cap appears nowhere
   * in the repo, so the class it belongs to could only ever have priced at zero.
   */
  it('models the new-beneficiary breach the matrix was missing', () => {
    expect(LIABILITY_MATRIX.new_beneficiary_breach).toBe(1000)
    expect(liabilityAmount({ issue: 'new_beneficiary_breach' })).toBe(1000)
  })
})
