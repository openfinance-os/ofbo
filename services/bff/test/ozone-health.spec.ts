import { describe, expect, it } from 'vitest'
import { DemoOzoneHealthSource } from '../src/ops/ozone-health.js'
import { OperationsConsoleService } from '../src/analytics/operations-console.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-70 — LFI Ozone Connect health-check surfacing: status, uptime, last
 * failure on the Operations Console platform-health screen.
 */

const ops: Principal = { subject: 'demo:ops', persona: 'operations-analyst', scopes: ['platform:operations:read'] }
const NOW = new Date('2026-06-16T12:00:00.000Z')

function svc(ozone?: ConstructorParameters<typeof OperationsConsoleService>[0]['ozone']) {
  return new OperationsConsoleService({
    certifications: { list: async () => [] },
    outages: { listActive: async () => [] },
    connectivity: { latest: async () => ({ ingested_at: '2026-06-16T11:00:00.000Z', published_at: '2026-05-28T00:00:00.000Z', freshness: 'fresh' }) },
    pipeline: { pipelineCounts: async () => ({}) },
    handover: { getFunnelEvents: async () => [] },
    now: () => NOW,
    ...(ozone ? { ozone } : {})
  })
}

describe('DemoOzoneHealthSource', () => {
  it('reports status, 30-day uptime, and a last-failure timestamp', async () => {
    const h = await new DemoOzoneHealthSource(() => NOW).getHealth()
    expect(h.status).toBe('up')
    expect(h.uptime_pct_30d).toBeGreaterThan(0)
    expect(h.checked_at).toBe(NOW.toISOString())
    expect(h.last_failure_at).toBeTruthy()
  })
})

describe('Operations Console Ozone Connect surface (BACKOFFICE-70)', () => {
  it('surfaces ozone_connect health in the view data (default demo source)', async () => {
    const { data } = await svc().view(ops)
    const oz = data.ozone_connect as { status: string; uptime_pct_30d: number; checked_at: string; last_failure_at: string | null }
    expect(oz.status).toBe('up')
    expect(typeof oz.uptime_pct_30d).toBe('number')
    expect(oz.checked_at).toBe(NOW.toISOString())
  })

  it('uses an injected health source (enterprise swap / down state)', async () => {
    const { data } = await svc({ getHealth: async () => ({ status: 'down', checked_at: NOW.toISOString(), uptime_pct_30d: 87.5, last_failure_at: NOW.toISOString() }) }).view(ops)
    const oz = data.ozone_connect as { status: string; uptime_pct_30d: number }
    expect(oz.status).toBe('down')
    expect(oz.uptime_pct_30d).toBe(87.5)
  })
})
