// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/respondent-disputes/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { RespondentDisputeStore } from '../src/respondent-disputes/service.js'
import type {
  StoredRespondentDispute,
  RespondentDisputeCreateInput,
  RespondentDisputeUpdate,
  RespondentDisputeListQuery,
  RespondentDisputePage
} from '@ofbo/db'

export class InMemoryRespondentDisputeStore implements RespondentDisputeStore {
  private readonly rows: StoredRespondentDispute[] = []
  async create(input: RespondentDisputeCreateInput): Promise<StoredRespondentDispute> {
    const record: StoredRespondentDispute = {
      id: crypto.randomUUID(),
      nebras_dispute_ref: input.nebras_dispute_ref,
      category: input.category,
      subject_summary: input.subject_summary ?? null,
      raised_at: input.raised_at,
      originating_break_id: input.originating_break_id ?? null,
      state: 'received',
      response_due_at: input.response_due_at,
      responded_at: null,
      resolution_due_at: input.resolution_due_at,
      resolved_at: null,
      appeal_due_at: null,
      appealed_at: null,
      implementation_due_at: null,
      implemented_at: null,
      verdict_outcome: null,
      created_at: new Date().toISOString()
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredRespondentDispute | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: RespondentDisputeListQuery): Promise<RespondentDisputePage> {
    let rows = this.rows
    if (query.state) rows = rows.filter((r) => r.state === query.state)
    return { rows: [...rows], next_cursor: null }
  }
  async update(id: string, patch: RespondentDisputeUpdate): Promise<StoredRespondentDispute | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.state !== undefined) r.state = patch.state
    if (patch.responded_at !== undefined && patch.responded_at !== null) r.responded_at = patch.responded_at
    if (patch.resolved_at !== undefined && patch.resolved_at !== null) r.resolved_at = patch.resolved_at
    if (patch.appeal_due_at !== undefined && patch.appeal_due_at !== null) r.appeal_due_at = patch.appeal_due_at
    if (patch.appealed_at !== undefined && patch.appealed_at !== null) r.appealed_at = patch.appealed_at
    if (patch.implementation_due_at !== undefined && patch.implementation_due_at !== null) r.implementation_due_at = patch.implementation_due_at
    if (patch.implemented_at !== undefined && patch.implemented_at !== null) r.implemented_at = patch.implemented_at
    if (patch.verdict_outcome !== undefined && patch.verdict_outcome !== null) r.verdict_outcome = patch.verdict_outcome
    return r
  }
}
