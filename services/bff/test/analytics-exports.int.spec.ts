import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter } from '@ofbo/db'
import { AnalyticsExportService, type ViewDataSource } from '../src/analytics/exports.js'
import { mintScopes, type Principal } from '../src/auth.js'

/**
 * BACKOFFICE-41 integration: an export logs the requester identity to the INSERT-only
 * audit under RLS (analytics_export, with view/format/integrity_hash). Real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const RISK: Principal = { subject: 'demo:risk-analyst', persona: 'risk-analyst', scopes: mintScopes('risk-analyst') }

const views: ViewDataSource = { getViewData: async () => ({ signal_summary: { active_total: 4 }, recent_signals: [] }) }

describe('analytics export — requester audited under RLS', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('persists an analytics_export audit with the requester + integrity hash', async () => {
    const svc = new AnalyticsExportService({ views, audit })
    const trace = randomUUID()
    const receipt = await svc.export(RISK, { view: 'risk-view', format: 'csv' }, trace)
    expect(receipt.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const row = await admin.query(
      `SELECT acting_principal, acting_persona, scope_used, request_body_redacted FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'analytics_export'`,
      [trace]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].acting_persona).toBe('risk-analyst')
    expect(row.rows[0].scope_used).toBe('risk:read')
    const body = row.rows[0].request_body_redacted as { view: string; format: string; integrity_hash: string }
    expect(body.view).toBe('risk-view')
    expect(body.format).toBe('csv')
    expect(body.integrity_hash).toBe(receipt.integrity_hash)
  })
})
