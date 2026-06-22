import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { OperationsConsoleService, type OperationsConsoleDeps } from '../src/analytics/operations-console.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import type { StoredCertification, StoredOutage } from '@ofbo/db'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-28 — Operations Console: Nebras connectivity + SLA targets, certification
 * per role (LFI/TPP), TPP onboarding pipeline, onboarding-handover health, active
 * outages — platform:operations:read, with the freshness envelope (BACKOFFICE-40).
 */

const ops: Principal = { subject: 'demo:ops', persona: 'operations-analyst', scopes: ['platform:operations:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const certs: StoredCertification[] = [
  { certification_id: 'c1', role: 'LFI', subject: 'Demo Bank (LFI)', track: 'Sandbox -> Prod', current_stage: 'Live-Proving', stages_total: 4, stages_completed: 3, status: 'live_proving', updated_at: '2026-06-01T00:00:00.000Z' },
  { certification_id: 'c2', role: 'TPP', subject: 'org-1', track: 'FAPI RP -> Live', current_stage: 'Live', stages_total: 4, stages_completed: 4, status: 'live', updated_at: '2026-06-01T00:00:00.000Z' }
]
const activeOutage: StoredOutage = { outage_id: 'o1', title: 'CoP slow', component: 'cop', severity: 'minor', status: 'active', started_at: '2026-06-15T09:00:00.000Z', resolved_at: null }

function svc(over: Partial<OperationsConsoleDeps> = {}) {
  return new OperationsConsoleService({
    certifications: { list: async () => certs },
    outages: { listActive: async () => [activeOutage] },
    connectivity: { latest: async () => ({ ingested_at: '2026-06-15T11:00:00.000Z', published_at: '2026-05-28T00:00:00.000Z', freshness: 'fresh' }) },
    pipeline: { pipelineCounts: async () => ({ registered: 2, onboarding: 1 }) },
    handover: { getFunnelEvents: async () => [
      { entry_path: 'DIRECT_SIGNUP', stage: 'kyc_complete', at: '2026-06-01T10:00:00Z' },
      { entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }
    ] },
    now: () => new Date('2026-06-15T12:00:00.000Z'),
    ...over
  })
}

describe('OperationsConsoleService — composition', () => {
  it('groups certification by role, counts pipeline + handover, lists active outages, connected', async () => {
    const { data, freshness } = await svc().view(ops)
    const cert = data.certification as { lfi: unknown[]; tpp: unknown[] }
    expect(cert.lfi).toHaveLength(1)
    expect(cert.tpp).toHaveLength(1)
    expect((data.nebras_connectivity as { status: string; sla_targets: { end_to_end_ms: number } }).status).toBe('connected')
    expect((data.nebras_connectivity as { sla_targets: { end_to_end_ms: number; lfi_internal_ms: number } }).sla_targets).toEqual({ end_to_end_ms: 500, lfi_internal_ms: 250 })
    expect((data.tpp_onboarding_pipeline as { total: number; by_state: Record<string, number> }).total).toBe(3)
    expect((data.onboarding_handover_health as { total_events: number }).total_events).toBe(2)
    expect(data.active_outage_count).toBe(1)
    expect((data.active_outages as unknown[])[0]).toMatchObject({ component: 'cop', severity: 'minor' })
    expect(freshness.stale).toBe(false)
    expect(freshness.view_refreshed_at).toBe('2026-06-15T12:00:00.000Z')
  })

  it('reports degraded connectivity (amber) when the last poll is stale', async () => {
    const { data, freshness } = await svc({ connectivity: { latest: async () => ({ ingested_at: '2026-06-10T00:00:00.000Z', published_at: '2026-05-28T00:00:00.000Z', freshness: 'stale' }) } }).view(ops)
    expect((data.nebras_connectivity as { status: string }).status).toBe('degraded')
    expect(freshness.stale).toBe(true)
    expect(freshness.stale_cause).toBe('last_nebras_poll_stale')
  })

  it('reports unknown connectivity when no ingestion has run yet', async () => {
    const { data, freshness } = await svc({ connectivity: { latest: async () => null } }).view(ops)
    expect((data.nebras_connectivity as { status: string }).status).toBe('unknown')
    expect(freshness.stale_cause).toBe('no_nebras_ingestion_yet')
  })

  it('UIF-05: emits typed bespoke sections (platform-health kpi-strip + pipeline bars + outages table)', async () => {
    const { data } = await svc().view(ops)
    const sections = data.sections as { kind: string; stats?: { label: string; value: string }[]; segments?: { label: string; value: number }[]; table?: { columns: string[]; rows: unknown[] } }[]
    const strip = sections.find((s) => s.kind === 'kpi-strip')
    expect(strip?.stats?.find((st) => st.label === 'Active outages')?.value).toBe('1')
    expect(strip?.stats?.find((st) => st.label === 'TPP onboarding')?.value).toBe('3')
    const bars = sections.find((s) => s.kind === 'contribution-bars')
    expect(bars?.segments?.map((g) => g.label).sort()).toEqual(['onboarding', 'registered'])
    const table = sections.find((s) => s.kind === 'object-table')
    expect(table?.table?.rows).toHaveLength(1)
  })

  it('rejects a principal without platform:operations:read (defence in depth)', async () => {
    await expect(svc().view(care)).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/operations-console (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope for operations-analyst', async () => {
    const res = await app.request('/back-office/analytics/operations-console', { headers: auth('operations-analyst') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data).toHaveProperty('nebras_connectivity')
    expect(body.data).toHaveProperty('certification')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/operations-console', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})
