// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/inquiries/bundle.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { ComplianceReportStore } from '../src/inquiries/bundle.js'
import type { ComplianceReportCreateInput, StoredComplianceReport } from '@ofbo/db'

export class InMemoryComplianceReportStore implements ComplianceReportStore {
  private readonly rows: StoredComplianceReport[] = []
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
    return record
  }
  async get(id: string): Promise<StoredComplianceReport | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
}
