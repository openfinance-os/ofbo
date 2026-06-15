import type { StoredCertification } from '@ofbo/db'

/**
 * BACKOFFICE-39 — Programme-level reporting (the Executive Dashboard Programme angle,
 * BACKOFFICE-27). Certification status per role, TPP onboarding readiness, CBUAE
 * mandatory-release-calendar alignment (delivery-vs-deadline gap), and multi-entity
 * group visibility where the bank operates several licensed entities. The release
 * calendar + group roster are engineering/programme-maintained reference data (like
 * the report templates and the liability matrix). Aggregate figures only, no PSU PII.
 */

export interface CbuaeRelease {
  release_id: string
  name: string
  mandatory_deadline: string // ISO date
  delivery_status: 'delivered' | 'in_progress' | 'not_started'
}

/** Engineering/programme-maintained CBUAE mandatory-release calendar (BD-08 cadence). */
export const CBUAE_RELEASE_CALENDAR: CbuaeRelease[] = [
  { release_id: 'OF-2026-Q2', name: 'Open Finance v2.1 conformance', mandatory_deadline: '2026-06-30', delivery_status: 'delivered' },
  { release_id: 'OF-2026-Q3', name: 'Insurance data-sharing onboarding', mandatory_deadline: '2026-09-30', delivery_status: 'in_progress' },
  { release_id: 'OF-2026-Q4', name: 'CAAP centralized auth migration', mandatory_deadline: '2026-12-31', delivery_status: 'not_started' }
]

/** Licensed entities in the bank's group (each with separate LFI certification). */
export const GROUP_ENTITIES: { entity_id: string; name: string; cert_subject: string }[] = [
  { entity_id: 'demo-bank-lfi', name: 'Demo Bank (LFI)', cert_subject: 'Demo Bank (LFI)' }
]

const DAY_MS = 24 * 3600 * 1000

export interface ProgrammeAngleBuilder {
  build(certs: StoredCertification[], pipelineCounts: Record<string, number>, now: Date): Record<string, unknown>
}

function releaseAlignment(now: Date) {
  const releases = CBUAE_RELEASE_CALENDAR.map((r) => {
    const daysToDeadline = Math.round((new Date(`${r.mandatory_deadline}T00:00:00.000Z`).getTime() - now.getTime()) / DAY_MS)
    const gap_status =
      r.delivery_status === 'delivered' ? 'delivered' : daysToDeadline < 0 ? 'overdue' : daysToDeadline <= 30 ? 'at_risk' : 'on_track'
    return { release_id: r.release_id, name: r.name, mandatory_deadline: r.mandatory_deadline, delivery_status: r.delivery_status, days_to_deadline: daysToDeadline, gap_status }
  })
  return {
    releases,
    overdue_count: releases.filter((r) => r.gap_status === 'overdue').length,
    at_risk_count: releases.filter((r) => r.gap_status === 'at_risk').length
  }
}

export class ProgrammeReportService implements ProgrammeAngleBuilder {
  build(certs: StoredCertification[], pipelineCounts: Record<string, number>, now: Date): Record<string, unknown> {
    const byRole = (role: string) =>
      certs.filter((c) => c.role === role).map((c) => ({ subject: c.subject, current_stage: c.current_stage, status: c.status, stages_completed: c.stages_completed, stages_total: c.stages_total }))
    const total = Object.values(pipelineCounts).reduce((a, b) => a + b, 0)
    const ready = (pipelineCounts.registered ?? 0)
    const inProgress = (pipelineCounts.onboarding ?? 0) + (pipelineCounts.unregistered ?? 0)
    const multiEntity = GROUP_ENTITIES.map((e) => {
      const cert = certs.find((c) => c.role === 'LFI' && c.subject === e.cert_subject)
      return { entity_id: e.entity_id, name: e.name, lfi_certification_status: cert?.status ?? 'unknown', current_stage: cert?.current_stage ?? null }
    })
    return {
      certification: { lfi: byRole('LFI'), tpp: byRole('TPP') },
      tpp_onboarding_readiness: { by_state: pipelineCounts, total, ready_count: ready, in_progress_count: inProgress },
      tpp_adoption: { by_state: pipelineCounts, total },
      release_calendar: releaseAlignment(now),
      multi_entity: { entity_count: multiEntity.length, entities: multiEntity }
    }
  }
}
