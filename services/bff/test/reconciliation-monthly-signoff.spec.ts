import { beforeAll, describe, expect, it } from 'vitest'
import type { ComplianceReportCreateInput, StoredComplianceReport } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import type { ComplianceReportStore } from '../src/inquiries/bundle.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-06 — monthly reconciliation summary + Finance sign-off. Generates +
 * locks the month's summary (run count, break dispositions, open Nebras disputes)
 * into a compliance_report with the Finance Analyst's IdP-attested sign-off +
 * integrity hash. finance:reconciliation:write.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'content-type': 'application/json', ...extra })

class CapturingReportStore implements ComplianceReportStore {
  created: ComplianceReportCreateInput[] = []
  async create(input: ComplianceReportCreateInput): Promise<StoredComplianceReport> {
    this.created.push(input)
    return {
      id: `rep-${this.created.length}`,
      report_type: input.report_type,
      status: input.status,
      reporting_period_start: input.reporting_period_start,
      reporting_period_end: input.reporting_period_end,
      classification: input.classification ?? 'restricted',
      requested_by: input.requested_by,
      approved_by: input.approved_by ?? null,
      integrity_hash: input.integrity_hash ?? null,
      generated_at: input.generated_at ?? null,
      submitted_at: null,
      approval_id: null,
      created_at: '2026-08-01T00:00:00.000Z'
    }
  }
  async get(): Promise<StoredComplianceReport | null> {
    return null
  }
}

describe('POST /back-office/reconciliation/monthly-signoff', () => {
  const logStore = new InMemoryReconciliationLogStore()
  const breakStore = new InMemoryReconciliationBreakStore()
  const reports = new CapturingReportStore()
  const audit = new InMemoryHighClassAuditSink()
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    // a daily run in 2026-07 → run_id recon-2026-07-14-daily, 8 flagged breaks
    await new ReconciliationService({ store: logStore, breakStore, audit: new InMemoryHighClassAuditSink() }).runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationLogStore: logStore, reconciliationBreakStore: breakStore, complianceReportStore: reports, highClassAudit: audit })
  })

  it('generates + locks the monthly summary as an IdP-attested signed compliance_report', async () => {
    const res = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm1' }), body: JSON.stringify({ period: '2026-07' }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { report_type: string; status: string; approved_by: string; requested_by: string; integrity_hash: string; generated_at: string } }
    expect(body.data.report_type).toBe('monthly_reconciliation')
    expect(body.data.status).toBe('approved')
    expect(body.data.approved_by).toBe(body.data.requested_by) // the signing Finance Analyst (IdP-attested)
    expect(body.data.approved_by).toBeTruthy()
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.data.generated_at).toBeTruthy()

    // the persisted summary aggregates the month's runs + break dispositions
    const content = reports.created[0]!.content as { period: string; run_count: number; breaks: { total: number; open: number }; open_nebras_disputes: number; tpp_aas_margin: { total_margin: number; by_fintech: Record<string, unknown> } }
    expect(content.period).toBe('2026-07')
    expect(content.run_count).toBe(1)
    expect(content.breaks.total).toBe(8)
    expect(content.breaks.open).toBe(8) // all flagged
    expect(content.open_nebras_disputes).toBe(0)
    expect(content.tpp_aas_margin.total_margin).toBeGreaterThan(0) // BACKOFFICE-07 real margin
    expect(Object.keys(content.tpp_aas_margin.by_fintech).length).toBeGreaterThan(0)
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_monthly_signoff')
    expect((ev?.request_body as { period: string }).period).toBe('2026-07')
  })

  it('replays the same Idempotency-Key (no second report); a different period is not shadowed', async () => {
    const created = reports.created.length
    const replay = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm1' }), body: JSON.stringify({ period: '2026-07' }) })
    expect(replay.status).toBe(200)
    expect(reports.created.length).toBe(created) // replayed, no new report
    const other = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm1' }), body: JSON.stringify({ period: '2026-08' }) })
    expect(other.status).toBe(200)
    expect(reports.created.length).toBe(created + 1) // different period ⇒ new report
  })

  it('400 invalid period; 400 missing Idempotency-Key; 403 without finance:reconciliation:write', async () => {
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm2' }), body: JSON.stringify({ period: '2026-7' }) })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance(), body: JSON.stringify({ period: '2026-07' }) })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'm3' }, body: JSON.stringify({ period: '2026-07' }) })).status).toBe(403)
  })
})
