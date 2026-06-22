import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations, seedDemoDataset, PgComplianceMetricsStore, PgAuditEmitter, PgLineageEmitter, retentionStatus, seedQueryPurposes, beginAppTx } from '@ofbo/db'
import { ComplianceViewService } from '../src/analytics/compliance-view.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-29 / BACKOFFICE-33 integration: the Compliance View aggregates over real regulated
 * tables via the GOVERNED cross-fintech path — reads run as bank_internal_view (purpose
 * `compliance_reporting`, seeded approved) and each is High-class logged — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const compliance: Principal = { subject: 'demo:compliance', persona: 'compliance-officer', scopes: ['audit:read', 'compliance:reports:read'] }

const pool = new pg.Pool({ connectionString: url })
const audit = new PgAuditEmitter(url!, TENANCY)
const lineage = new PgLineageEmitter(url!, TENANCY)

async function countBypassLogs(): Promise<number> {
  const c = await pool.connect()
  try {
    await c.query(beginAppTx(TENANCY.bankId))
    const r = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE event_type = 'cross_fintech_query'`)
    await c.query('COMMIT')
    return r.rows[0].n as number
  } finally {
    c.release()
  }
}

describe('Compliance View — governed cross-fintech aggregates over real tables', () => {
  const metrics = new PgComplianceMetricsStore(url!, TENANCY, audit)

  beforeAll(async () => {
    await applyMigrations(url!)
    await seedDemoDataset(url!)
    await seedQueryPurposes(pool, TENANCY.bankId, TENANCY.channel, { lineage }) // compliance_reporting → approved
  })
  afterAll(async () => {
    await metrics.close()
    await pool.end()
    await audit.close()
    await lineage.close()
  })

  it('reports seeded consent volumes + retention posture, residency enforced — via the governed path', async () => {
    const svc = new ComplianceViewService({ metrics, retention: { retentionStatus: () => retentionStatus(url!) } })
    const before = await countBypassLogs()
    const { data, freshness } = await svc.view(compliance, 'trace-int-compliance')

    expect((data.consent_volumes as { total: number }).total).toBeGreaterThan(0) // seeded consent audit events, read cross-tenant
    const retention = data.retention_status as { tables: { table_name: string }[]; deletion_allowed: boolean }
    expect(retention.tables.length).toBeGreaterThan(0)
    expect(retention.deletion_allowed).toBe(false)
    expect(data.residency_posture).toMatchObject({ region: 'UAE', data_residency: 'enforced' })
    expect(freshness.stale).toBe(false)

    // Each of the 4 governed metric reads is High-class logged as a cross_fintech_query bypass.
    expect(await countBypassLogs()).toBe(before + 4)
  })
})
