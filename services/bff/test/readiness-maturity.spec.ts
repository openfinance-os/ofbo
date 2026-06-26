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

  it('derives one port row per catalog port — every sim ready; P2 enterprise ready, the rest stubs', () => {
    const m = getMaturity()
    expect(m.ports).toHaveLength(PORTS.length)
    expect(m.ports.map((p) => p.id)).toEqual(PORTS.map((p) => p.id))
    expect(m.ports.every((p) => p.sim_status === 'ready')).toBe(true)
    expect(m.summary.sim_adapters_ready).toBe(PORTS.length)
    // P2 Entra ID ships a reference enterprise adapter (ADR 0023); the rest remain M6 work.
    expect(m.ports.find((p) => p.id === 'P2')!.enterprise_status).toBe('ready')
    expect(m.ports.filter((p) => p.enterprise_status === 'stub')).toHaveLength(PORTS.length - 1)
    expect(m.summary.enterprise_adapters_remaining).toBe(PORTS.length - 1)
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
    expect(body.data.summary.enterprise_adapters_remaining).toBe(8) // P2 Entra reference adapter ships
    expect(body.meta.request_id).toBeTruthy()
  })
})
