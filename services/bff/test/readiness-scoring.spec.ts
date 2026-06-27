import { describe, it, expect } from 'vitest'
import { getCatalog, PORTS, DECISIONS } from '../src/readiness/catalog.js'
import { assess, ReadinessInputError, type AssessmentInput } from '../src/readiness/scoring.js'

const POINTS = { low: 100, medium: 70, scoping: 30 }
// Pick, per port, the lowest-effort option actually offered (P6/P9 have no `low` option).
const bestEffort = (): AssessmentInput => ({
  ports: Object.fromEntries(
    PORTS.map((p) => [p.id, [...p.options].sort((a, b) => POINTS[b.effort_band] - POINTS[a.effort_band])[0]!.value])
  )
})
const allScoping = (): AssessmentInput => ({
  ports: Object.fromEntries(PORTS.map((p) => [p.id, p.options.find((o) => o.effort_band === 'scoping')!.value]))
})

describe('readiness catalog', () => {
  it('exposes all 9 ports and 16 decisions, every option banded', () => {
    const c = getCatalog()
    expect(c.ports).toHaveLength(9)
    expect(c.ports.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'])
    expect(c.decisions).toHaveLength(16)
    for (const p of c.ports) {
      expect(p.options.length).toBeGreaterThan(0)
      for (const o of p.options) expect(['low', 'medium', 'scoping']).toContain(o.effort_band)
    }
  })

  it('P6 egress is never below medium — mTLS + scheme cert chain', () => {
    const p6 = PORTS.find((p) => p.id === 'P6')!
    for (const o of p6.options) expect(o.effort_band === 'low').toBe(false)
  })

  it('the three blocking decisions are flagged', () => {
    const blocking = DECISIONS.filter((d) => d.blocks).map((d) => d.id)
    expect(blocking).toEqual(['BD-01', 'BD-04', 'BD-13'])
  })
})

describe('assess — scoring', () => {
  it('is deterministic: same input → identical digest', () => {
    const input = bestEffort()
    expect(assess(input)).toEqual(assess(input))
  })

  it('the best realistic estate caps at 93 — P6 and P9 never go below medium', () => {
    const d = assess(bestEffort())
    expect(d.score).toBe(93)
    expect(d.ports.find((p) => p.id === 'P6')!.effort_band).toBe('medium')
    expect(d.ports.find((p) => p.id === 'P9')!.effort_band).toBe('medium')
    expect(d.verdict).toMatch(/fast path to production/)
  })

  it('all-scoping estate scores 30 with an integration-discovery verdict', () => {
    const d = assess(allScoping())
    expect(d.score).toBe(30)
    expect(d.verdict).toMatch(/integration-discovery/)
    expect(d.verdict).toMatch(/Heaviest lift: P\d/)
  })

  it('unselected ports default to scoping rather than crashing', () => {
    const d = assess({ ports: { P2: 'okta' } })
    expect(d.ports.find((p) => p.id === 'P2')!.effort_band).toBe('low')
    expect(d.ports.find((p) => p.id === 'P4')!.chosen_system).toBe('Not selected yet')
    expect(d.ports.find((p) => p.id === 'P4')!.effort_band).toBe('scoping')
  })
})

describe('assess — adapter status & sequencing', () => {
  it('built-in / declined choices need no enterprise adapter and drop out of the swap order', () => {
    const d = assess({ ports: { P1: 'portal_resident', P3: 'email_fallback', P8: 'not_integrating', P2: 'okta' } })
    const p1 = d.ports.find((p) => p.id === 'P1')!
    expect(p1.adapter_status).toBe('sim_ready')
    expect(p1.config_keys).toEqual([])
    const swapPorts = d.sequencing.map((s) => s.port)
    expect(swapPorts).not.toContain('P1')
    expect(swapPorts).not.toContain('P3')
    expect(swapPorts).not.toContain('P8')
    expect(swapPorts).toContain('P2')
  })

  it('a non-built-in choice maps to enterprise_reference (a reference adapter ships; ADR 0023/0024)', () => {
    const d = assess({ ports: { P2: 'okta' } })
    const p2 = d.ports.find((p) => p.id === 'P2')!
    // not "to write from scratch": every port ships a reference enterprise adapter today;
    // the bank's remaining work is config + the per-bank production cutover (M6).
    expect(p2.adapter_status).toBe('enterprise_reference')
    const step = d.sequencing.find((s) => s.port === 'P2')!
    expect(step.action.toLowerCase()).toContain('reference')
    expect(step.action.toLowerCase()).toContain('configure')
    expect(step.action.toLowerCase()).not.toContain('write the')
  })

  it('sequencing follows the M6 order (P2 before P6 before P4)', () => {
    const d = assess(bestEffort())
    const order = d.sequencing.map((s) => s.port)
    expect(order.indexOf('P2')).toBeLessThan(order.indexOf('P6'))
    expect(order.indexOf('P6')).toBeLessThan(order.indexOf('P4'))
    expect(d.sequencing[0]!.step).toBe(1)
  })
})

describe('assess — governance register', () => {
  it('marks defaults vs overrides and carries blockers', () => {
    const d = assess({ ports: { P2: 'okta' }, decisions: { 'BD-12': 'group entity' } })
    const bd12 = d.governance.find((g) => g.id === 'BD-12')!
    expect(bd12.is_default).toBe(false)
    expect(bd12.answer).toBe('group entity')
    const bd01 = d.governance.find((g) => g.id === 'BD-01')!
    expect(bd01.is_default).toBe(true)
    expect(bd01.blocker).toContain('M1')
  })

  it('reflects governance answers in the generated Bank Profile', () => {
    const d = assess({ ports: { P2: 'okta' }, decisions: { 'BD-12': 'group', 'BD-03': 'narrow single-scope' } })
    expect(d.generated_profile.DEPLOY_PROFILE).toBe('enterprise')
    expect(d.generated_profile.BANK_ID_SCOPE).toBe('group')
    expect(d.generated_profile.FRAUD_REVOKE_FOUR_EYES).toBe('false')
    expect(d.generated_profile.P2_SYSTEM).toBe('Okta')
  })

  it('already_done frames the work as bounded — reference adapters ship, remaining work is config + cutover', () => {
    const d = assess(bestEffort())
    expect(d.already_done.sim_adapters_ready).toBe(9)
    expect(d.already_done.ports_total).toBe(9)
    expect(d.already_done.note.toLowerCase()).toContain('reference')
  })
})

describe('assess — validation', () => {
  it('rejects an unknown port id', () => {
    expect(() => assess({ ports: { P99: 'x' } })).toThrow(ReadinessInputError)
  })
  it('rejects an unknown option for a known port', () => {
    expect(() => assess({ ports: { P2: 'not-a-real-idp' } })).toThrow(ReadinessInputError)
  })
  it('rejects an unknown decision id', () => {
    expect(() => assess({ ports: { P2: 'okta' }, decisions: { 'BD-99': 'x' } })).toThrow(/Unknown decision/)
  })
  it('rejects a missing ports object', () => {
    expect(() => assess({} as AssessmentInput)).toThrow(ReadinessInputError)
  })
})
