import { beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { ComplianceReportCreateInput, StoredComplianceReport } from '@ofbo/db'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import type { ComplianceReportStore } from '../src/inquiries/bundle.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-08 — CBUAE-format reconciliation export. Every run + break in the
 * date range becomes a line with a per-line SHA-256 hash + an overall integrity
 * hash, persisted as a compliance_report (awaiting_approval). 202 + Report.
 * compliance:reports:generate.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
// wide range — the in-memory stores stamp created_at at real wall-clock time
const WIDE = 'period_start=2020-01-01&period_end=2099-12-31'
const compliance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer', ...extra })

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

describe('GET /back-office/reconciliation/exports:cbuae', () => {
  const reports = new CapturingReportStore()
  const audit = new InMemoryHighClassAuditSink()
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    const logStore = new InMemoryReconciliationLogStore()
    const breakStore = new InMemoryReconciliationBreakStore()
    await new ReconciliationService({ store: logStore, breakStore, audit: new InMemoryHighClassAuditSink() }).runDaily('seed', { window: WINDOW })
    app = createApp({ reconciliationLogStore: logStore, reconciliationBreakStore: breakStore, complianceReportStore: reports, highClassAudit: audit })
  })

  it('generates a 202 CBUAE export with per-line + overall integrity hashes', async () => {
    const res = await app.request(`/back-office/reconciliation/exports:cbuae?${WIDE}`, { headers: compliance() })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { report_type: string; status: string; integrity_hash: string } }
    expect(body.data.report_type).toBe('cbuae_reconciliation_export')
    expect(body.data.status).toBe('awaiting_approval') // CBUAE submission is four-eyes (-35)
    expect(body.data.integrity_hash).toMatch(/^[0-9a-f]{64}$/)

    const content = reports.created[0]!.content as {
      run_count: number
      break_count: number
      sections: { runs: unknown[]; breaks: unknown[] }
      line_hashes: { runs: string[]; breaks: string[] }
    }
    expect(content.run_count).toBe(1)
    expect(content.break_count).toBe(8)
    expect(content.line_hashes.runs).toHaveLength(1)
    expect(content.line_hashes.breaks).toHaveLength(8)
    // verifiable: re-hashing the PERSISTED line reproduces the stored hash
    const canonical = (v: unknown): string => {
      const norm = (x: unknown): unknown =>
        x === null || typeof x !== 'object' ? x : Array.isArray(x) ? x.map(norm) : Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])]))
      return JSON.stringify(norm(v))
    }
    const reHash = createHash('sha256').update(canonical(content.sections.breaks[0])).digest('hex')
    expect(reHash).toBe(content.line_hashes.breaks[0])
    const ev = audit.events.find((e) => e.event_type === 'cbuae_reconciliation_export_generated')
    expect((ev?.request_body as { break_count: number }).break_count).toBe(8)
  })

  it('400 on missing query params, invalid date, or start > end', async () => {
    expect((await app.request('/back-office/reconciliation/exports:cbuae', { headers: compliance() })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/exports:cbuae?period_start=2026-7-1&period_end=2026-07-31', { headers: compliance() })).status).toBe(400)
    expect((await app.request('/back-office/reconciliation/exports:cbuae?period_start=2026-08-01&period_end=2026-07-01', { headers: compliance() })).status).toBe(400)
  })

  it('rejects a persona without compliance:reports:generate (403) — Finance has reconciliation but not the report-generate scope', async () => {
    const res = await app.request(`/back-office/reconciliation/exports:cbuae?${WIDE}`, {
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' }
    })
    expect(res.status).toBe(403)
  })
})
