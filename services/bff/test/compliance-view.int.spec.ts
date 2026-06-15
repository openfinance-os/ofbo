import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, seedDemoDataset, PgComplianceMetricsStore, retentionStatus } from '@ofbo/db'
import { ComplianceViewService } from '../src/analytics/compliance-view.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-29 integration: the Compliance View aggregates over real regulated
 * tables under RLS — seeded consent volumes (consent_admin_event) + the full
 * retention lifecycle posture — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const compliance: Principal = { subject: 'demo:compliance', persona: 'compliance-officer', scopes: ['audit:read', 'compliance:reports:read'] }

describe('Compliance View — aggregates over real tables (RLS)', () => {
  const metrics = new PgComplianceMetricsStore(url!, TENANCY)

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedDemoDataset(url!)
  })
  afterAll(async () => {
    await metrics.close()
  })

  it('reports seeded consent volumes + the retention lifecycle posture, residency enforced', async () => {
    const svc = new ComplianceViewService({ metrics, retention: { retentionStatus: () => retentionStatus(url!) } })
    const { data, freshness } = await svc.view(compliance)

    expect((data.consent_volumes as { total: number }).total).toBeGreaterThan(0) // seeded consent audit events
    const retention = data.retention_status as { tables: { table_name: string }[]; deletion_allowed: boolean }
    expect(retention.tables.length).toBeGreaterThan(0) // audit_high_sensitivity etc. have rows
    expect(retention.deletion_allowed).toBe(false)
    expect(data.residency_posture).toMatchObject({ region: 'UAE', data_residency: 'enforced' })
    expect(freshness.stale).toBe(false)
  })
})
