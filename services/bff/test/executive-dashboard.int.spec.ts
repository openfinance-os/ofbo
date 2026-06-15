import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, seedDemoDataset, PgLineageEmitter, PgReconciliationLogStore, PgCertificationStore, PgComplianceMetricsStore, PgTppCounterpartyStore } from '@ofbo/db'
import { ReconciliationService, InMemoryReconciliationBreakStore } from '../src/reconciliation/service.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { ExecutiveDashboardService } from '../src/analytics/executive-dashboard.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-27 integration: the Executive Dashboard composes real stores — TPP-aaS
 * margin re-derived from a real reconciliation run (commercial angle) and seeded
 * certification per role (programme angle) — under RLS, for a super-admin (both angles).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const now = () => new Date('2026-05-15T12:00:00.000Z') // period 2026-05 (the sim's margin period)
const superAdmin: Principal = { subject: 'demo:super', persona: 'platform-super-admin', scopes: ['platform:superadmin'] }

describe('Executive Dashboard — composition over real stores (RLS)', () => {
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const reconLog = new PgReconciliationLogStore(url!, TENANCY, lineage)
  const certifications = new PgCertificationStore(url!, TENANCY)
  const complianceMetrics = new PgComplianceMetricsStore(url!, TENANCY)
  const tpp = new PgTppCounterpartyStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedDemoDataset(url!)
    // produce a real reconciliation run for 2026-05 so margin is non-empty
    const recon = new ReconciliationService({ store: reconLog, breakStore: new InMemoryReconciliationBreakStore(), audit: new InMemoryHighClassAuditSink() })
    await recon.runDaily('trace-exec-int', { window: { start: '2026-05-15T00:00:00.000Z', end: '2026-05-16T00:00:00.000Z' } })
  })
  afterAll(async () => {
    await reconLog.close()
    await certifications.close()
    await complianceMetrics.close()
    await tpp.close()
    await lineage.close()
  })

  it('super-admin sees both angles with real margin + seeded certification', async () => {
    const recon = new ReconciliationService({ store: reconLog, breakStore: new InMemoryReconciliationBreakStore(), audit: new InMemoryHighClassAuditSink() })
    const svc = new ExecutiveDashboardService({
      consents: complianceMetrics,
      margin: { marginForPeriod: (period) => recon.computeMarginForPeriod(period) },
      pipeline: {
        pipelineCounts: async () => {
          const { rows } = await tpp.list({ limit: 200 })
          return rows.reduce<Record<string, number>>((acc, r) => ((acc[r.registration_state] = (acc[r.registration_state] ?? 0) + 1), acc), {})
        }
      },
      certifications,
      recon: {
        latestRun: async () => {
          const { rows } = await reconLog.list({ limit: 1 })
          const r = rows[0]
          return r ? { line_count_total: r.line_count_total ?? 0, line_count_matched: r.line_count_matched ?? 0 } : null
        }
      },
      handover: { getFunnelEvents: async () => [] },
      now
    })

    const { data } = await svc.view(superAdmin)
    expect(data.available_angles).toEqual(['commercial', 'programme'])
    const commercial = data.commercial as { tpp_aas_margin: { total_margin: number }; integration_pipeline: { total: number } }
    expect(commercial.tpp_aas_margin.total_margin).toBeGreaterThan(0) // real margin from the run
    expect(commercial.integration_pipeline.total).toBeGreaterThan(0) // seeded TPP registry
    const programme = data.programme as { certification: { lfi: unknown[]; tpp: unknown[] } }
    expect(programme.certification.lfi.length + programme.certification.tpp.length).toBeGreaterThan(0) // seeded certs
    const headline = data.headline as { consent_volumes: { total: number } }
    expect(headline.consent_volumes.total).toBeGreaterThan(0) // seeded consent events
  })
})
