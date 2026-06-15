import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations, seedDemoDataset, PgLineageEmitter, PgCertificationStore, PgOutageStore, PgNebrasSnapshotStore, PgTppCounterpartyStore } from '@ofbo/db'
import { OperationsConsoleService } from '../src/analytics/operations-console.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-28 integration: the Operations Console reads seeded certification
 * (per role) + outages + the TPP onboarding pipeline under RLS, and derives Nebras
 * connectivity from a real BACKOFFICE-32 ingestion snapshot — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const ops: Principal = { subject: 'demo:ops', persona: 'operations-analyst', scopes: ['platform:operations:read'] }

describe('Operations Console — seeded certification/outage/pipeline + live connectivity (RLS)', () => {
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const certifications = new PgCertificationStore(url!, TENANCY)
  const outages = new PgOutageStore(url!, TENANCY)
  const snapshots = new PgNebrasSnapshotStore(url!, TENANCY, lineage)
  const tpp = new PgTppCounterpartyStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedDemoDataset(url!)
  })
  afterAll(async () => {
    await certifications.close()
    await outages.close()
    await snapshots.close()
    await tpp.close()
    await lineage.close()
  })

  it('composes certification per role, pipeline counts, zero active outages, connected', async () => {
    // a fresh ingestion snapshot → connectivity 'connected'
    await snapshots.create({ source: 'tpp_reports', period: '2026-08', run_id: `ops-int-${randomUUID()}`, published_at: '2026-08-28T00:00:00.000Z', rows: [] }, randomUUID())

    const svc = new OperationsConsoleService({
      certifications,
      outages,
      connectivity: snapshots,
      pipeline: { pipelineCounts: async () => {
        const { rows } = await tpp.list({ limit: 200 })
        return rows.reduce<Record<string, number>>((acc, r) => ((acc[r.registration_state] = (acc[r.registration_state] ?? 0) + 1), acc), {})
      } },
      handover: { getFunnelEvents: async () => [{ entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }] }
    })

    const { data, freshness } = await svc.view(ops)
    const cert = data.certification as { lfi: unknown[]; tpp: unknown[] }
    expect(cert.lfi.length).toBeGreaterThanOrEqual(1) // seeded LFI cert
    expect(cert.tpp.length).toBeGreaterThanOrEqual(2) // seeded TPP app certs
    expect(data.active_outage_count).toBe(0) // the seeded outage is resolved
    expect((data.tpp_onboarding_pipeline as { total: number }).total).toBeGreaterThan(0) // seeded TPP registry
    expect((data.nebras_connectivity as { status: string }).status).toBe('connected')
    expect(freshness.stale).toBe(false)
  })
})
