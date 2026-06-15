import { describe, expect, it } from 'vitest'
import { ProgrammeReportService, CBUAE_RELEASE_CALENDAR } from '../src/analytics/programme.js'
import type { StoredCertification } from '@ofbo/db'

/**
 * BACKOFFICE-39 — Programme-level reporting: certification per role, TPP onboarding
 * readiness, CBUAE release-calendar alignment (delivery-vs-deadline gap), multi-entity
 * group visibility. (Surfaced as the Executive Dashboard Programme angle.)
 */

const certs: StoredCertification[] = [
  { certification_id: 'c1', role: 'LFI', subject: 'Demo Bank (LFI)', track: 't', current_stage: 'Live-Proving', stages_total: 4, stages_completed: 3, status: 'live_proving', updated_at: '2026-06-01T00:00:00.000Z' },
  { certification_id: 'c2', role: 'TPP', subject: 'org-1', track: 't', current_stage: 'Live', stages_total: 4, stages_completed: 4, status: 'live', updated_at: '2026-06-01T00:00:00.000Z' }
]
const pipeline = { registered: 3, onboarding: 1, unregistered: 2 }

describe('ProgrammeReportService', () => {
  it('builds certification per role, onboarding readiness, and multi-entity visibility', () => {
    const out = new ProgrammeReportService().build(certs, pipeline, new Date('2026-06-15T00:00:00.000Z'))
    const cert = out.certification as { lfi: unknown[]; tpp: unknown[] }
    expect(cert.lfi).toHaveLength(1)
    expect(cert.tpp).toHaveLength(1)
    const readiness = out.tpp_onboarding_readiness as { total: number; ready_count: number; in_progress_count: number }
    expect(readiness).toMatchObject({ total: 6, ready_count: 3, in_progress_count: 3 })
    const me = out.multi_entity as { entity_count: number; entities: { name: string; lfi_certification_status: string }[] }
    expect(me.entity_count).toBe(1)
    expect(me.entities[0]).toMatchObject({ name: 'Demo Bank (LFI)', lfi_certification_status: 'live_proving' })
  })

  it('computes the release-calendar delivery-vs-deadline gap (delivered / on_track / at_risk / overdue)', () => {
    // "now" between Q2 (delivered) and Q3 (deadline 2026-09-30): pick a date making Q3 at_risk
    const rc = new ProgrammeReportService().build(certs, pipeline, new Date('2026-09-15T00:00:00.000Z')).release_calendar as {
      releases: { release_id: string; gap_status: string; days_to_deadline: number }[]
      overdue_count: number
      at_risk_count: number
    }
    const byId = Object.fromEntries(rc.releases.map((r) => [r.release_id, r]))
    expect(byId['OF-2026-Q2']!.gap_status).toBe('delivered') // delivery_status delivered
    expect(byId['OF-2026-Q3']!.gap_status).toBe('at_risk') // ~15 days to 2026-09-30
    expect(byId['OF-2026-Q4']!.gap_status).toBe('on_track') // far out
    expect(rc.at_risk_count).toBeGreaterThanOrEqual(1)
  })

  it('flags an overdue mandatory release', () => {
    // a date past Q3's deadline with Q3 still in_progress → overdue
    const rc = new ProgrammeReportService().build(certs, pipeline, new Date('2026-10-15T00:00:00.000Z')).release_calendar as {
      releases: { release_id: string; gap_status: string }[]
      overdue_count: number
    }
    const q3 = rc.releases.find((r) => r.release_id === 'OF-2026-Q3')!
    expect(q3.gap_status).toBe('overdue')
    expect(rc.overdue_count).toBeGreaterThanOrEqual(1)
  })

  it('exposes the engineering-maintained CBUAE release calendar', () => {
    expect(CBUAE_RELEASE_CALENDAR.length).toBeGreaterThanOrEqual(3)
  })
})
