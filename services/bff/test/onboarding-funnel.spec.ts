import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { OnboardingFunnelService } from '../src/analytics/onboarding-funnel.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import type { OnboardingCase } from '@ofbo/ports'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-34 — onboarding funnel: five metrics (cycle time, handover count, stage
 * abandonment, cross-sell conversion, entry-path mix) with drill-down by entry path.
 */

const pipeline: Principal = { subject: 'demo:cdh', persona: 'commercial-desk-head', scopes: ['platform:analytics:read', 'pipeline:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const CASES: OnboardingCase[] = [
  { case_id: 'd1', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-01T00:00:00.000Z', activated_at: '2026-06-01T10:00:00.000Z', cross_sell: true },
  { case_id: 'd2', entry_path: 'DIRECT_SIGNUP', reached_stages: ['initiated', 'kyc'], abandoned_at_stage: 'kyc', started_at: '2026-06-02T00:00:00.000Z', activated_at: null, cross_sell: false },
  { case_id: 'h1', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated', 'kyc', 'consent_grant', 'activated'], abandoned_at_stage: null, started_at: '2026-06-03T00:00:00.000Z', activated_at: '2026-06-03T04:00:00.000Z', cross_sell: false },
  { case_id: 'h2', entry_path: 'ONBOARDING_HANDOVER', reached_stages: ['initiated'], abandoned_at_stage: 'initiated', started_at: '2026-06-04T00:00:00.000Z', activated_at: null, cross_sell: false }
]

const svc = (cases = CASES) => new OnboardingFunnelService({ cases: { getOnboardingCases: async () => cases }, now: () => new Date('2026-06-15T12:00:00.000Z') })

describe('OnboardingFunnelService — five metrics', () => {
  it('computes entry-path mix, handover count, abandonment, cross-sell, cycle time', async () => {
    const { data, freshness } = await svc().view(pipeline)
    expect(data.total_cases).toBe(4)
    // metric 5 — entry-path mix
    expect(data.entry_path_mix).toEqual({ DIRECT_SIGNUP: 2, ONBOARDING_HANDOVER: 2 })
    // metric 2 — handover count
    expect(data.handover_count).toBe(2)
    const overall = data.overall as { cycle_time: { activated_count: number; avg_hours: number }; stage_abandonment: { by_stage: Record<string, number>; total: number }; cross_sell_conversion: { activated: number; cross_sold: number; rate: number } }
    // metric 3 — stage abandonment
    expect(overall.stage_abandonment.total).toBe(2)
    expect(overall.stage_abandonment.by_stage).toEqual({ kyc: 1, initiated: 1 })
    // metric 4 — cross-sell conversion (2 activated, 1 cross-sold)
    expect(overall.cross_sell_conversion).toMatchObject({ activated: 2, cross_sold: 1, rate: 0.5 })
    // metric 1 — cycle time (d1=10h, h1=4h → avg 7)
    expect(overall.cycle_time.activated_count).toBe(2)
    expect(overall.cycle_time.avg_hours).toBe(7)
    expect(freshness.stale).toBe(false)
  })

  it('drills down by entry path', async () => {
    const { data } = await svc().view(pipeline)
    const byPath = data.by_entry_path as Record<string, { cycle_time: { avg_hours: number | null }; cross_sell_conversion: { cross_sold: number } }>
    expect(byPath.DIRECT_SIGNUP!.cycle_time.avg_hours).toBe(10) // only d1 activated
    expect(byPath.ONBOARDING_HANDOVER!.cycle_time.avg_hours).toBe(4) // only h1 activated
    expect(byPath.DIRECT_SIGNUP!.cross_sell_conversion.cross_sold).toBe(1)
    expect(byPath.ONBOARDING_HANDOVER!.cross_sell_conversion.cross_sold).toBe(0)
  })

  it('rejects a principal without pipeline:read (defence in depth)', async () => {
    await expect(svc().view(care)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/onboarding-funnel (HTTP, real P8 sim adapter)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the five metrics computed over the deterministic sim cases', async () => {
    const res = await app.request('/back-office/analytics/onboarding-funnel', { headers: auth('commercial-desk-head') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { total_cases: number; handover_count: number; entry_path_mix: Record<string, number>; overall: { stage_abandonment: { total: number } } }; freshness: { stale: boolean } }
    expect(body.data.total_cases).toBe(8) // the sim's deterministic set
    expect(body.data.entry_path_mix).toEqual({ DIRECT_SIGNUP: 5, ONBOARDING_HANDOVER: 3 })
    expect(body.data.handover_count).toBe(3)
    expect(body.data.overall.stage_abandonment.total).toBe(3)
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/onboarding-funnel', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})
