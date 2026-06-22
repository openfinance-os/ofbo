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
// the second pair of eyes: a different subject that satisfies finance:reconciliation:write
// (platform:superadmin satisfies any scope check) — initiator ≠ approver.
const approver = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:platform-super-admin', 'x-superadmin-justification': 'four-eyes approval of the monthly reconciliation sign-off (test)', 'content-type': 'application/json', ...extra })

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

  it('four-eyes: a maker requests (202 + approval_request, no inline lock); a different finance principal approves → the locked signed report', async () => {
    const init = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm1' }), body: JSON.stringify({ period: '2026-07' }) })
    expect(init.status).toBe(202) // 202 + approval_request — never executes inline (four-eyes hard-stop)
    const approvalId = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    expect(approvalId).toBeTruthy()
    expect(reports.created.length).toBe(0) // nothing locked on the request

    // self-approval rejected (four-eyes) — the initiator cannot approve their own request
    const self = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: finance({ 'idempotency-key': 's1' }) })
    expect(self.status).toBe(409)
    expect(reports.created.length).toBe(0)

    // a different finance:reconciliation:write principal approves → the report is generated + locked on approval
    const ok = await app.request(`/approvals/${approvalId}:approve`, { method: 'POST', headers: approver({ 'idempotency-key': 'a1' }) })
    expect(ok.status).toBe(200)
    const report = ((await ok.json()) as { data: { execution_result?: { report_type: string; status: string; approved_by: string; requested_by: string; integrity_hash: string } } }).data.execution_result!
    expect(report.report_type).toBe('monthly_reconciliation')
    expect(report.status).toBe('approved')
    expect(report.approved_by).toBe(report.requested_by) // attested to the INITIATING Finance Analyst
    expect(report.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(reports.created.length).toBe(1)

    // the persisted summary aggregates the month's runs + break dispositions
    const content = reports.created[0]!.content as { period: string; run_count: number; breaks: { total: number; open: number }; open_nebras_disputes: number; tpp_aas_margin: { total_margin: number; by_fintech: Record<string, unknown> } }
    expect(content.period).toBe('2026-07')
    expect(content.run_count).toBe(1)
    expect(content.breaks.total).toBe(8)
    expect(content.breaks.open).toBe(8) // all flagged
    expect(content.tpp_aas_margin.total_margin).toBeGreaterThan(0) // BACKOFFICE-07 real margin
    expect(Object.keys(content.tpp_aas_margin.by_fintech).length).toBeGreaterThan(0)
    // the execution is High-class logged, attributed to the initiator + flagged four-eyes-approved
    const ev = audit.events.find((e) => e.event_type === 'reconciliation_monthly_signoff')
    expect((ev?.request_body as { period: string; four_eyes_approved: boolean }).period).toBe('2026-07')
    expect((ev?.request_body as { four_eyes_approved: boolean }).four_eyes_approved).toBe(true)
  })

  it('replaying the request Idempotency-Key returns the same approval (no second request)', async () => {
    const init = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm-idem' }), body: JSON.stringify({ period: '2026-08' }) })
    const a1 = ((await init.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    const replay = await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm-idem' }), body: JSON.stringify({ period: '2026-08' }) })
    const a2 = ((await replay.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    expect(replay.status).toBe(202)
    expect(a2).toBe(a1) // same approval replayed, not a new one
  })

  it('400 invalid period; 400 missing Idempotency-Key; 403 without finance:reconciliation:write — all before any approval is created', async () => {
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance({ 'idempotency-key': 'm2' }), body: JSON.stringify({ period: '2026-7' }) })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: finance(), body: JSON.stringify({ period: '2026-07' }) })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/monthly-signoff', { method: 'POST', headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent', 'content-type': 'application/json', 'idempotency-key': 'm3' }, body: JSON.stringify({ period: '2026-07' }) })).status).toBe(403)
  })
})
