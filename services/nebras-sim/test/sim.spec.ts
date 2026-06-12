import { beforeEach, describe, expect, it } from 'vitest'
import { createNebrasSim } from '../src/app.js'

/**
 * M1-NEBRAS-SIM acceptance = PRD §3.1 P6 + §9 M1 exit criteria, executable:
 * deterministic UAE OF v2.1-shaped payloads, <5s revoke acknowledgment, and
 * injectable faults so reconciliation breaks and liability signals can be
 * triggered live during a demo.
 */

let app: ReturnType<typeof createNebrasSim>
beforeEach(() => {
  app = createNebrasSim()
})

const CONSENT = '4d2c2e2a-0000-4000-8000-000000000000'

describe('Nebras simulator v1 — consent surface', () => {
  it('acknowledges a consent revocation well inside the 5s scheme SLA', async () => {
    const res = await app.request(`/consent-manager/consents/${CONSENT}/revoke`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { consent_id: string; status: string; acknowledged_in_ms: number }
    expect(body.consent_id).toBe(CONSENT)
    expect(body.status).toBe('Revoked')
    expect(body.acknowledged_in_ms).toBeLessThan(5000)
  })

  it('reports consent state for drift checks', async () => {
    await app.request(`/consent-manager/consents/${CONSENT}/revoke`, { method: 'POST' })
    const res = await app.request(`/consent-manager/consents/${CONSENT}`)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('Revoked')
  })
})

describe('Nebras simulator v1 — reports surfaces', () => {
  it('serves deterministic TPP billing reports (same period → byte-identical)', async () => {
    const a = await (await app.request('/tpp-reports/2026-05')).json()
    const b = await (await app.request('/tpp-reports/2026-05')).json()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const rows = (a as { rows: { line_ref: string; fee: { amount: number; currency: string } }[] }).rows
    expect(rows.length).toBeGreaterThanOrEqual(100)
    for (const r of rows.slice(0, 5)) {
      expect(Number.isInteger(r.fee.amount)).toBe(true) // binding Money: integer minor units
      expect(r.fee.currency).toBe('AED')
    }
  })

  it('different periods produce different datasets', async () => {
    const may = await (await app.request('/tpp-reports/2026-05')).json()
    const june = await (await app.request('/tpp-reports/2026-06')).json()
    expect(JSON.stringify(may)).not.toBe(JSON.stringify(june))
  })

  it('serves the dataset surface', async () => {
    const res = await app.request('/datasets/consents/2026-05')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: unknown[] }
    expect(body.rows.length).toBeGreaterThan(0)
  })
})

describe('Nebras simulator v1 — fault injection (the demo trigger)', () => {
  it('injected revoke_delay makes the next acknowledgment breach the 5s SLA — visibly', async () => {
    await app.request('/admin/faults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'revoke_delay', delay_ms: 7000 })
    })
    const res = await app.request(`/consent-manager/consents/${CONSENT}/revoke`, { method: 'POST' })
    const body = (await res.json()) as { acknowledged_in_ms: number }
    expect(body.acknowledged_in_ms).toBeGreaterThanOrEqual(7000)
  })

  it('injected fee_variance perturbs exactly one report line by the requested amount', async () => {
    const clean = (await (await app.request('/tpp-reports/2026-05')).json()) as { rows: { line_ref: string; fee: { amount: number } }[] }
    await app.request('/admin/faults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'fee_variance', period: '2026-05', variance_minor_units: 25 })
    })
    const dirty = (await (await app.request('/tpp-reports/2026-05')).json()) as { rows: { line_ref: string; fee: { amount: number } }[] }
    const diffs = dirty.rows.filter((r, i) => r.fee.amount !== clean.rows[i]!.fee.amount)
    expect(diffs).toHaveLength(1)
    const i = dirty.rows.findIndex((r, idx) => r.fee.amount !== clean.rows[idx]!.fee.amount)
    expect(dirty.rows[i]!.fee.amount - clean.rows[i]!.fee.amount).toBe(25)
  })

  it('injected consent_drift makes the consent surface disagree with the platform mirror', async () => {
    await app.request('/admin/faults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'consent_drift', consent_id: CONSENT })
    })
    const res = await app.request(`/consent-manager/consents/${CONSENT}`)
    const body = (await res.json()) as { status: string; drift_injected: boolean }
    expect(body.drift_injected).toBe(true)
  })

  it('faults are listable and resettable (repeatable demos)', async () => {
    await app.request('/admin/faults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'revoke_delay', delay_ms: 7000 })
    })
    const list = (await (await app.request('/admin/faults')).json()) as { faults: unknown[] }
    expect(list.faults).toHaveLength(1)
    await app.request('/admin/faults', { method: 'DELETE' })
    const after = (await (await app.request('/admin/faults')).json()) as { faults: unknown[] }
    expect(after.faults).toHaveLength(0)
    const res = await app.request(`/consent-manager/consents/${CONSENT}/revoke`, { method: 'POST' })
    expect(((await res.json()) as { acknowledged_in_ms: number }).acknowledged_in_ms).toBeLessThan(5000)
  })

  it('rejects unknown fault types', async () => {
    const res = await app.request('/admin/faults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'set-everything-on-fire' })
    })
    expect(res.status).toBe(400)
  })
})
