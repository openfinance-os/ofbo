import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ExecutiveDashboardService, type ExecutiveDashboardDeps } from '../src/analytics/executive-dashboard.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import { emptyMargin, type MarginSummary } from '../src/reconciliation/margin.js'
import type { StoredCertification, GovernedReadContext } from '@ofbo/db'
import { ProgrammeReportService } from '../src/analytics/programme.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-27 — Executive Dashboard: one canonical dashboard, persona-aware angles.
 * Commercial (commercial:read) = revenue/margin/pipeline; Programme (programme:read) =
 * adoption/certification. Shared headline for every platform:analytics:read holder.
 */

const commercial: Principal = { subject: 'demo:cdh', persona: 'commercial-desk-head', scopes: ['platform:analytics:read', 'commercial:read', 'pipeline:read'] }
const programme: Principal = { subject: 'demo:pm', persona: 'programme-manager', scopes: ['platform:analytics:read', 'programme:read', 'certification:read'] }
// a holder of only the base scope (no commercial/programme sub-scope) — sees the headline, no angle
const analyticsOnly: Principal = { subject: 'demo:base', persona: 'commercial-desk-head', scopes: ['platform:analytics:read'] }
const superAdmin: Principal = { subject: 'demo:super', persona: 'platform-super-admin', scopes: ['platform:superadmin'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const margin: MarginSummary = {
  ...emptyMargin(),
  total_margin: 30,
  total_nebras_fee: 250,
  total_fintech_charge: 280,
  by_fintech: {
    'org-1': { client_id: 'org-1', total_margin: 30, by_family: { SIP: { nebras_fee: 150, fintech_charge: 170, margin: 20 }, AISP: { nebras_fee: 100, fintech_charge: 110, margin: 10 } } }
  }
}
const certs: StoredCertification[] = [
  { certification_id: 'c1', role: 'LFI', subject: 'Demo Bank', track: 't', current_stage: 'Live-Proving', stages_total: 4, stages_completed: 3, status: 'live_proving', updated_at: '2026-06-01T00:00:00.000Z' }
]

function svc(over: Partial<ExecutiveDashboardDeps> = {}) {
  return new ExecutiveDashboardService({
    consents: { consentVolumes: async () => ({ total: 5, by_event_type: { consent_granted: 5 } }) },
    margin: { marginForPeriod: async () => margin },
    pipeline: { pipelineCounts: async () => ({ registered: 2, onboarding: 1 }) },
    certifications: { list: async () => certs },
    recon: { latestRun: async () => ({ line_count_total: 100, line_count_matched: 95 }) },
    handover: { getFunnelEvents: async () => [{ entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }] },
    programme: new ProgrammeReportService(),
    now: () => new Date('2026-06-15T12:00:00.000Z'),
    ...over
  })
}

describe('ExecutiveDashboardService — persona-aware angles', () => {
  it('commercial persona sees the headline + commercial angle only (revenue by family, margin, pipeline)', async () => {
    const { data } = await svc().view(commercial, 'trace-1')
    expect(data.available_angles).toEqual(['commercial'])
    expect(data).toHaveProperty('commercial')
    expect(data).not.toHaveProperty('programme')
    const commercialAngle = data.commercial as { revenue_by_product_family: Record<string, { margin: number }>; tpp_aas_margin: { total_margin: number } }
    expect(commercialAngle.revenue_by_product_family.SIP!.margin).toBe(20)
    expect(commercialAngle.revenue_by_product_family.AISP!.margin).toBe(10)
    expect(commercialAngle.tpp_aas_margin.total_margin).toBe(30)
    // headline visible to all
    const headline = data.headline as { reconciliation_throughput: { success_rate: number } }
    expect(headline.reconciliation_throughput.success_rate).toBe(0.95)
  })

  it('UIF-03: emits typed bespoke sections for the commercial persona (gauge + kpi-strip + margin-by-family bars)', async () => {
    const { data } = await svc().view(commercial, 'trace-1')
    const sections = data.sections as { kind: string; title: string; gauge?: { value: number }; stats?: { label: string; value: string }[]; segments?: { label: string; value: number }[] }[]
    const gauge = sections.find((s) => s.kind === 'gauge')
    expect(gauge?.gauge?.value).toBe(95) // success_rate 0.95 → 95%
    const strip = sections.find((s) => s.kind === 'kpi-strip')
    expect(strip?.stats?.find((st) => st.label === 'TPP-AAS net margin')?.value).toBe('AED 0.30') // 30 minor units
    const bars = sections.find((s) => s.kind === 'contribution-bars')
    expect(bars?.segments?.map((g) => g.label).sort()).toEqual(['AISP', 'SIP'])
  })

  it('UIF-03: a base-scope persona gets the gauge section but NOT the commercial sections (scope hygiene)', async () => {
    const { data } = await svc().view(analyticsOnly, 'trace-1')
    const sections = data.sections as { kind: string }[]
    expect(sections.some((s) => s.kind === 'gauge')).toBe(true)
    expect(sections.some((s) => s.kind === 'kpi-strip')).toBe(false)
    expect(sections.some((s) => s.kind === 'contribution-bars')).toBe(false)
  })

  it('programme persona sees the headline + programme angle only (certification, adoption); NOT commercial revenue', async () => {
    const { data } = await svc().view(programme, 'trace-1')
    expect(data.available_angles).toEqual(['programme'])
    expect(data).toHaveProperty('programme')
    expect(data).not.toHaveProperty('commercial') // scope hygiene: no commercial revenue leak
    const prog = data.programme as { certification: { lfi: unknown[] } }
    expect(prog.certification.lfi).toHaveLength(1)
  })

  it('super-admin sees both angles (marker scope)', async () => {
    const { data } = await svc().view(superAdmin, 'trace-1')
    expect(data.available_angles).toEqual(['commercial', 'programme'])
  })

  it('platform:analytics:read alone sees the headline but no angle', async () => {
    const { data } = await svc().view(analyticsOnly, 'trace-1')
    expect(data.available_angles).toEqual([])
    expect(data).toHaveProperty('headline')
    expect(data).not.toHaveProperty('commercial')
    expect(data).not.toHaveProperty('programme')
  })

  it('rejects a principal without platform:analytics:read (defence in depth)', async () => {
    await expect(svc().view(care, 'trace-1')).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('BACKOFFICE-33: reads platform-wide consent volumes through the governed path under purpose executive_dashboard', async () => {
    let seen: GovernedReadContext | undefined
    const consents = {
      consentVolumes: async (ctx?: GovernedReadContext) => {
        seen = ctx
        return { total: 5, by_event_type: { consent_granted: 5 } }
      }
    }
    await svc({ consents }).view(commercial, 'trace-xyz')
    expect(seen).toBeDefined()
    expect(seen?.purposeCode).toBe('executive_dashboard') // distinct from the compliance store default
    expect(seen?.actingPrincipal).toBe('demo:cdh')
    expect(seen?.scopeUsed).toBe('platform:analytics:read')
    expect(seen?.traceId).toBe('trace-xyz')
  })
})

describe('GET /back-office/analytics/executive-dashboard (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope for commercial-desk-head', async () => {
    const res = await app.request('/back-office/analytics/executive-dashboard', { headers: auth('commercial-desk-head') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { available_angles: string[] }; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data.available_angles).toContain('commercial')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('programme-manager gets the programme angle', async () => {
    const res = await app.request('/back-office/analytics/executive-dashboard', { headers: auth('programme-manager') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { available_angles: string[] } }
    expect(body.data.available_angles).toEqual(['programme'])
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/executive-dashboard', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})
