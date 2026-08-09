// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/disputes/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { DisputeStore, Money } from '../src/disputes/service.js'
import type { CrossSchemeUpdate, DisputeCreateInput, DisputeListQuery, DisputePage, StoredDisputeRecord } from '@ofbo/db'

export class InMemoryDisputeStore implements DisputeStore {
  private readonly rows: StoredDisputeRecord[] = []
  async create(input: DisputeCreateInput): Promise<StoredDisputeRecord> {
    const now = new Date().toISOString()
    const record: StoredDisputeRecord = {
      id: crypto.randomUUID(),
      psu_identifier: input.psu_identifier,
      dispute_type: input.dispute_type,
      state: 'open',
      originating_payment_id: input.originating_payment_id ?? null,
      originating_consent_id: input.originating_consent_id ?? null,
      originating_call_id: input.originating_call_id ?? null,
      dispute_reason_code: input.dispute_reason_code ?? null,
      sla_clock_started_at: now,
      refund_required_by: null,
      refund_initiated_at: null,
      refund_amount: null,
      nebras_case_id: input.nebras_case_id ?? null,
      care_case_id: null,
      assigned_to: null,
      aani_case_id: input.aani_case_id ?? null,
      cross_scheme: input.aani_case_id
        ? { aani_case_id: input.aani_case_id, aani_recall_window_expires_at: null, settled_in_other_scheme: false, compensation_blocked: false, sanadak_reference: null, sanadak_escalated_at: null }
        : null,
      created_at: now
    }
    this.rows.push(record)
    return record
  }
  async get(id: string): Promise<StoredDisputeRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async list(query: DisputeListQuery): Promise<DisputePage> {
    let rows = this.rows
    if (query.state) rows = rows.filter((r) => r.state === query.state)
    if (query.psu_identifier) rows = rows.filter((r) => r.psu_identifier === query.psu_identifier)
    return { rows, next_cursor: null }
  }
  async markRefundInitiated(id: string, refundAmount: Money, refundRequiredBy: string): Promise<StoredDisputeRecord | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    r.state = 'refund_initiated'
    r.refund_initiated_at = new Date().toISOString()
    r.refund_required_by = refundRequiredBy
    r.refund_amount = refundAmount
    return r
  }
  async updateState(id: string, patch: { state?: string; escalated_to?: string | null; resolution_note?: string | null }): Promise<StoredDisputeRecord | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    if (patch.state) r.state = patch.state
    // escalated_to / resolution_note are write-only columns (not on the DisputeCase
    // wire projection) — persisted by the Pg store; the in-memory store tracks state.
    return r
  }
  async recordCrossScheme(id: string, patch: CrossSchemeUpdate): Promise<StoredDisputeRecord | null> {
    const r = this.rows.find((x) => x.id === id)
    if (!r) return null
    const cs = r.cross_scheme ?? { aani_case_id: null, aani_recall_window_expires_at: null, settled_in_other_scheme: false, compensation_blocked: false, sanadak_reference: null, sanadak_escalated_at: null }
    if (patch.aani_case_id !== undefined && patch.aani_case_id !== null) cs.aani_case_id = patch.aani_case_id
    if (patch.aani_recall_window_expires_at !== undefined && patch.aani_recall_window_expires_at !== null) cs.aani_recall_window_expires_at = patch.aani_recall_window_expires_at
    if (patch.settled_in_other_scheme !== undefined) cs.settled_in_other_scheme = patch.settled_in_other_scheme
    if (patch.compensation_blocked !== undefined) cs.compensation_blocked = patch.compensation_blocked
    if (patch.sanadak_reference !== undefined && patch.sanadak_reference !== null) cs.sanadak_reference = patch.sanadak_reference
    if (patch.sanadak_escalated_at !== undefined && patch.sanadak_escalated_at !== null) cs.sanadak_escalated_at = patch.sanadak_escalated_at
    if (patch.aani_case_id) r.aani_case_id = patch.aani_case_id
    r.cross_scheme = cs
    return r
  }
}
