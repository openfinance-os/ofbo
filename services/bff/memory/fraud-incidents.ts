// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/fraud-incidents/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { FraudIncidentStore } from '../src/fraud-incidents/service.js'
import type {
  StoredFraudIncident,
  FraudIncidentCreateInput,
  FraudIncidentUpdate,
  FraudIncidentListQuery,
  FraudIncidentPage
} from '@ofbo/db'

export class InMemoryFraudIncidentStore implements FraudIncidentStore {
  private readonly rows: StoredFraudIncident[] = []
  async create(input: FraudIncidentCreateInput): Promise<StoredFraudIncident> {
    const now = new Date().toISOString()
    const record: StoredFraudIncident = {
      id: crypto.randomUUID(),
      consent_id: input.consent_id ?? null,
      client_id: input.client_id ?? null,
      nebras_severity: input.nebras_severity,
      itsm_priority: input.itsm_priority,
      nebras_case_reference: input.nebras_case_reference ?? null,
      status: input.status,
      operational_pause: input.operational_pause,
      scheme_imposed_hold: input.scheme_imposed_hold,
      summary: input.summary,
      opened_by: input.opened_by,
      opened_at: now,
      reported_at: input.reported_at ?? null,
      resolved_at: null
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredFraudIncident | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: FraudIncidentListQuery): Promise<FraudIncidentPage> {
    let rows = this.rows
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.nebras_severity) rows = rows.filter((r) => r.nebras_severity === query.nebras_severity)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: FraudIncidentUpdate): Promise<StoredFraudIncident | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.status !== undefined) r.status = patch.status
    if (patch.operational_pause !== undefined) r.operational_pause = patch.operational_pause
    if (patch.resolved_at !== undefined) r.resolved_at = patch.resolved_at
    return r
  }
}
