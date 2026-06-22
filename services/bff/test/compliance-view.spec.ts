import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ComplianceViewService, type ComplianceViewDeps } from '../src/analytics/compliance-view.js'
import { ScopeDeniedError } from '../src/rbac.js'
import type { Principal } from '../src/auth.js'
import type { RetentionStatusRow } from '@ofbo/db'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-29 — Compliance View: consent volumes, retention posture, dispute +
 * risk-signal backlog, report library + inquiry history, residency posture —
 * compliance:reports:read, with the freshness envelope (BACKOFFICE-40).
 */

const compliance: Principal = { subject: 'demo:compliance', persona: 'compliance-officer', scopes: ['audit:read', 'compliance:reports:read'] }
const care: Principal = { subject: 'demo:care', persona: 'customer-care-agent', scopes: ['consents:admin'] }

const retentionRows: RetentionStatusRow[] = [
  { table_name: 'audit_high_sensitivity', hot_months: 24, immutable_months: 60, row_count: 100, hot_tier_count: 95, warm_tier_count: 5, past_immutable_count: 0, due_for_warm_tier: 5, oldest_record_at: '2024-06-01T00:00:00.000Z' },
  { table_name: 'reconciliation_log', hot_months: 24, immutable_months: 60, row_count: 10, hot_tier_count: 8, warm_tier_count: 1, past_immutable_count: 1, due_for_warm_tier: 2, oldest_record_at: '2020-01-01T00:00:00.000Z' }
]

function svc(over: Partial<ComplianceViewDeps> = {}) {
  return new ComplianceViewService({
    metrics: {
      consentVolumes: async () => ({ total: 7, by_event_type: { consent_granted: 4, consent_revoked: 3 } }),
      disputeBacklog: async () => ({ open: 2, by_state: { open: 1, in_progress: 1, resolved: 5 } }),
      riskSignalBacklog: async () => ({ open: 3, by_severity: { high: 1, medium: 2 } }),
      reportLibrary: async () => ({ by_status: { approved: 4 }, by_type: { 'cbuae-inquiry': 2, monthly: 2 }, recent_inquiries: [{ id: 'r1', reporting_period_start: '2026-05-01T00:00:00.000Z', reporting_period_end: '2026-05-31T00:00:00.000Z', status: 'approved', generated_at: '2026-06-01T00:00:00.000Z' }] })
    },
    retention: { retentionStatus: async () => retentionRows },
    now: () => new Date('2026-06-15T12:00:00.000Z'),
    ...over
  })
}

describe('ComplianceViewService — composition', () => {
  it('composes consent volumes, retention posture, backlogs, report library + inquiry history', async () => {
    const { data, freshness } = await svc().view(compliance, 'trace-test')
    expect((data.consent_volumes as { total: number }).total).toBe(7)
    expect(data.residency_posture).toMatchObject({ region: 'UAE', data_residency: 'enforced' })
    const retention = data.retention_status as { tables: unknown[]; overdue_tables: string[]; deletion_allowed: boolean }
    expect(retention.tables).toHaveLength(2)
    expect(retention.overdue_tables).toEqual(['reconciliation_log']) // past_immutable_count > 0
    expect(retention.deletion_allowed).toBe(false)
    expect((data.dispute_backlog as { open: number }).open).toBe(2)
    expect((data.risk_signal_backlog as { open: number }).open).toBe(3)
    expect((data.inquiry_history as unknown[]).length).toBe(1)
    expect(data.periodic_report_generation_deeplink).toBe('/back-office/reports:generate')
    expect(freshness.stale).toBe(false)
    expect(freshness.view_refreshed_at).toBe('2026-06-15T12:00:00.000Z')
  })

  it('UIF: emits typed sections the portal renders as bespoke panels (no PSU PII)', async () => {
    const { data } = await svc().view(compliance, 'trace-test')
    const sections = data.sections as { kind: string; title: string; stats?: { label: string; value: string }[]; segments?: { label: string; value: number }[]; alert?: { severity: string }; table?: { columns: string[]; rows: unknown[] } }[]
    const byKind = (k: string) => sections.filter((s) => s.kind === k)

    const kpi = byKind('kpi-strip')[0]!
    expect(kpi.title).toBe('Compliance Posture')
    expect(kpi.stats?.map((s) => s.label)).toEqual(['Consent events', 'Open disputes', 'Open risk signals', 'Reports awaiting approval'])
    expect(kpi.stats?.find((s) => s.label === 'Open risk signals')?.value).toBe('3')

    // retention alert fires because reconciliation_log is past the immutable boundary
    expect(byKind('alert')[0]?.alert?.severity).toBe('critical')
    // risk signals by severity → contribution bars (non-zero severities only)
    expect(byKind('contribution-bars')[0]?.segments).toEqual([{ label: 'high', value: 1 }, { label: 'medium', value: 2 }])
    // retention lifecycle table
    const table = byKind('object-table')[0]?.table
    expect(table?.columns).toContain('past_immutable_count')
    expect(table?.rows).toHaveLength(2)

    // PII guard: aggregate counts / table names only
    expect(JSON.stringify(sections)).not.toMatch(/784|emirates|iban|psu_/i)
  })

  it('rejects a principal without compliance:reports:read (defence in depth)', async () => {
    await expect(svc().view(care, 'trace-test')).rejects.toBeInstanceOf(ScopeDeniedError)
  })
})

describe('GET /back-office/analytics/compliance-view (HTTP)', () => {
  const app = createApp()
  const auth = (persona: string) => ({ ...FAPI_HEADERS, authorization: `Bearer demo-token:${persona}` })

  it('returns 200 with the AnalyticsView envelope for compliance-officer', async () => {
    const res = await app.request('/back-office/analytics/compliance-view', { headers: auth('compliance-officer') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { request_id: string }; freshness: { stale: boolean } }
    expect(body.meta.request_id).toBeTruthy()
    expect(body.data).toHaveProperty('retention_status')
    expect(body.data).toHaveProperty('consent_volumes')
    expect(body.freshness).toHaveProperty('stale')
  })

  it('rejects a wrong-scope persona at the BFF middleware (403)', async () => {
    const res = await app.request('/back-office/analytics/compliance-view', { headers: auth('customer-care-agent') })
    expect(res.status).toBe(403)
  })
})
