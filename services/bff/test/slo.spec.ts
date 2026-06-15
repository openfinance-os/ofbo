import { describe, expect, it } from 'vitest'
import { computeSlo, summarizeSlos } from '../src/analytics/slo.js'
import { OperationsConsoleService } from '../src/analytics/operations-console.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-58 — SLO observability: target, error-budget remaining, burn rate per
 * SLO, surfaced in the Operations Console (no separate APM login).
 */

const ops: Principal = { subject: 'demo:ops', persona: 'operations-analyst', scopes: ['platform:operations:read'] }

describe('computeSlo (error budget + burn rate)', () => {
  it('healthy: observed above target → budget mostly intact, burn < 1', () => {
    const s = computeSlo({ key: 'k', description: 'd', target_pct: 99.0, observed_pct: 99.6, window_days: 30 })
    // allowed 1.0, consumed 0.4 → remaining 60%, burn 0.4
    expect(s.error_budget_remaining_pct).toBe(60)
    expect(s.burn_rate).toBe(0.4)
    expect(s.status).toBe('healthy')
  })

  it('breach: observed below target → budget exhausted, burn > 1', () => {
    const s = computeSlo({ key: 'k', description: 'd', target_pct: 99.5, observed_pct: 99.3, window_days: 30 })
    // allowed 0.5, consumed 0.7 → remaining 0, burn 1.4
    expect(s.error_budget_remaining_pct).toBe(0)
    expect(s.burn_rate).toBeGreaterThan(1)
    expect(s.status).toBe('breach')
  })

  it('at_risk: remaining between 0 and 25%', () => {
    const s = computeSlo({ key: 'k', description: 'd', target_pct: 99.5, observed_pct: 99.55, window_days: 30 })
    // allowed 0.5, consumed 0.45 → remaining 10%
    expect(s.error_budget_remaining_pct).toBeGreaterThan(0)
    expect(s.error_budget_remaining_pct).toBeLessThan(25)
    expect(s.status).toBe('at_risk')
  })

  it('target 100% → no error budget, no div-by-zero (remaining 100, burn 0)', () => {
    const s = computeSlo({ key: 'k', description: 'd', target_pct: 100, observed_pct: 99.9, window_days: 30 })
    expect(s.error_budget_remaining_pct).toBe(100)
    expect(s.burn_rate).toBe(0)
    expect(s.status).toBe('healthy')
  })

  it('summarizeSlos counts by status', () => {
    const slos = [
      computeSlo({ key: 'a', description: '', target_pct: 99, observed_pct: 99.9, window_days: 30 }),
      computeSlo({ key: 'b', description: '', target_pct: 99.5, observed_pct: 99.55, window_days: 30 }),
      computeSlo({ key: 'c', description: '', target_pct: 99.5, observed_pct: 99.0, window_days: 30 })
    ]
    expect(summarizeSlos(slos)).toEqual({ healthy: 1, at_risk: 1, breach: 1 })
  })
})

describe('Operations Console SLO panel (BACKOFFICE-58)', () => {
  function svc(slo?: ConstructorParameters<typeof OperationsConsoleService>[0]['slo']) {
    return new OperationsConsoleService({
      certifications: { list: async () => [] },
      outages: { listActive: async () => [] },
      connectivity: { latest: async () => ({ ingested_at: '2026-06-15T11:00:00.000Z', published_at: '2026-05-28T00:00:00.000Z', freshness: 'fresh' }) },
      pipeline: { pipelineCounts: async () => ({}) },
      handover: { getFunnelEvents: async () => [] },
      now: () => new Date('2026-06-15T12:00:00.000Z'),
      ...(slo ? { slo } : {})
    })
  }

  it('includes an slo section with computed statuses + a summary (default demo reader)', async () => {
    const { data } = await svc().view(ops)
    const slo = data.slo as { window_days: number; summary: { healthy: number; at_risk: number; breach: number }; slos: { key: string; error_budget_remaining_pct: number; burn_rate: number; status: string }[] }
    expect(slo.slos.length).toBeGreaterThan(0)
    expect(slo.window_days).toBe(30)
    // every entry carries target/observed-derived budget + burn + status
    expect(slo.slos.every((s) => typeof s.error_budget_remaining_pct === 'number' && typeof s.burn_rate === 'number' && !!s.status)).toBe(true)
    const totals = slo.summary.healthy + slo.summary.at_risk + slo.summary.breach
    expect(totals).toBe(slo.slos.length)
  })

  it('uses an injected SLO reader (enterprise swap)', async () => {
    const { data } = await svc({ getSloObservations: async () => [{ key: 'custom', description: 'd', target_pct: 99.9, observed_pct: 99.0, window_days: 7 }] }).view(ops)
    const slo = data.slo as { slos: { key: string; status: string }[]; window_days: number }
    expect(slo.slos).toHaveLength(1)
    expect(slo.slos[0]!.key).toBe('custom')
    expect(slo.slos[0]!.status).toBe('breach') // observed 99.0 ≪ target 99.9
    expect(slo.window_days).toBe(7)
  })
})
