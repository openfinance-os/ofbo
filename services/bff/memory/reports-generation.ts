// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/reports/generation.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { ReportStore } from '../src/reports/generation.js'
import type { ComplianceReportCreateInput, StoredComplianceReport, ComplianceReportListQuery, ComplianceReportPage } from '@ofbo/db'

export class InMemoryReportStore implements ReportStore {
  private readonly rows: StoredComplianceReport[] = []
  private readonly contents = new Map<string, unknown>()
  async create(input: ComplianceReportCreateInput): Promise<StoredComplianceReport> {
    const now = new Date().toISOString()
    const record: StoredComplianceReport = {
      id: crypto.randomUUID(),
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
      approval_id: input.approval_id ?? null,
      created_at: now
    }
    this.rows.push(record)
    this.contents.set(record.id, input.content ?? null)
    return record
  }
  async get(id: string): Promise<StoredComplianceReport | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async getContent(id: string): Promise<unknown | null> {
    return this.contents.get(id) ?? null
  }
  async markStatus(id: string, status: string, patch: { approved_by?: string | null; submitted_at?: string | null; approval_id?: string | null }): Promise<StoredComplianceReport | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    r.status = status
    if (patch.approved_by != null) r.approved_by = patch.approved_by
    if (patch.submitted_at != null) r.submitted_at = patch.submitted_at
    if (patch.approval_id != null) r.approval_id = patch.approval_id
    return r
  }
  async list(query: ComplianceReportListQuery = {}): Promise<ComplianceReportPage> {
    let rows = [...this.rows].reverse()
    if (query.report_type) rows = rows.filter((r) => r.report_type === query.report_type)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}
