import { describe, it, expect } from 'vitest'
import { getMaturity } from '../src/readiness/maturity.js'
import { PORTS } from '../src/readiness/catalog.js'
import { createApp } from '../src/app.js'

describe('product maturity', () => {
  it('tracks the M0–M6 roadmap with M6 the only remaining milestone', () => {
    const m = getMaturity()
    expect(m.milestones.map((x) => x.id)).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'])
    const remaining = m.milestones.filter((x) => x.status === 'remaining')
    expect(remaining.map((x) => x.id)).toEqual(['M6'])
    expect(m.summary.milestones_done).toBe(6)
    expect(m.summary.milestones_total).toBe(7)
  })

  it('derives one port row per catalog port — every sim ready; the 5 reference adapters ready, rest stubs', () => {
    const m = getMaturity()
    expect(m.ports).toHaveLength(PORTS.length)
    expect(m.ports.map((p) => p.id)).toEqual(PORTS.map((p) => p.id))
    expect(m.ports.every((p) => p.sim_status === 'ready')).toBe(true)
    expect(m.summary.sim_adapters_ready).toBe(PORTS.length)
    // P1 CRM, P2 Entra (ADR 0023), P3 ServiceNow, P5 OTLP, P9 Kong Konnect ship reference adapters.
    const ready = ['P1', 'P2', 'P3', 'P5', 'P9']
    for (const id of ready) expect(m.ports.find((p) => p.id === id)!.enterprise_status).toBe('ready')
    expect(m.ports.filter((p) => p.enterprise_status === 'stub')).toHaveLength(PORTS.length - ready.length)
    expect(m.summary.enterprise_adapters_remaining).toBe(PORTS.length - ready.length)
    // the contract-test gate is carried through from the catalog, not invented
    expect(m.ports[0]!.contract_test_gate).toBe(PORTS[0]!.contract_test_gate)
  })

  it('is deterministic', () => {
    expect(getMaturity()).toEqual(getMaturity())
  })
})

describe('GET /public/readiness/maturity', () => {
  it('serves the maturity summary publicly (no auth, no FAPI header)', async () => {
    const res = await createApp().request('/public/readiness/maturity', { headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ReturnType<typeof getMaturity>; meta: { request_id: string } }
    expect(body.data.milestones).toHaveLength(7)
    expect(body.data.ports).toHaveLength(9)
    expect(body.data.summary.enterprise_adapters_remaining).toBe(4) // 5 reference adapters ship (P1/P2/P3/P5/P9)
    expect(body.meta.request_id).toBeTruthy()
  })
})
