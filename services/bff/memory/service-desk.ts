// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/service-desk/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { ServiceDeskCaseStore } from '../src/service-desk/service.js'
import type {
  StoredServiceDeskCase,
  ServiceDeskCaseCreateInput,
  ServiceDeskCaseUpdate,
  ServiceDeskCaseListQuery,
  ServiceDeskCasePage
} from '@ofbo/db'

export class InMemoryServiceDeskCaseStore implements ServiceDeskCaseStore {
  private readonly rows: StoredServiceDeskCase[] = []
  async create(input: ServiceDeskCaseCreateInput): Promise<StoredServiceDeskCase> {
    const now = new Date().toISOString()
    const record: StoredServiceDeskCase = {
      id: crypto.randomUUID(),
      nebras_case_reference: input.nebras_case_reference,
      case_type: input.case_type,
      priority: input.priority,
      status: input.status,
      summary: input.summary,
      sla_due_at: input.sla_due_at,
      linked_break_id: input.linked_break_id ?? null,
      linked_dispute_id: input.linked_dispute_id ?? null,
      linked_signal_id: input.linked_signal_id ?? null,
      opened_by: input.opened_by,
      opened_at: now,
      resolved_at: null,
      created_at: now
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredServiceDeskCase | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: ServiceDeskCaseListQuery): Promise<ServiceDeskCasePage> {
    let rows = this.rows
    if (query.case_type) rows = rows.filter((r) => r.case_type === query.case_type)
    if (query.priority) rows = rows.filter((r) => r.priority === query.priority)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: ServiceDeskCaseUpdate): Promise<StoredServiceDeskCase | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.priority !== undefined) r.priority = patch.priority
    if (patch.resolved_at !== undefined && patch.resolved_at !== null) r.resolved_at = patch.resolved_at
    return r
  }
}
