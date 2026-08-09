// CODE-02 — in-memory reconciliation stores. Moved verbatim out of
// src/reconciliation/service.ts (which carried them in its last 150 lines on top of a
// 900-line service). Behaviour is unchanged; see ./README.md for why they live here.
import type {
  StoredReconciliationRun,
  ReconciliationRunCreateInput,
  ReconciliationRunListQuery,
  ReconciliationRunPage,
  StoredReconciliationBreak,
  ReconciliationBreakCreateInput,
  ReconciliationBreakListQuery,
  ReconciliationBreakPage
} from '@ofbo/db'
import type { ReconciliationLogStore, ReconciliationBreakStore, ThresholdStore } from '../src/reconciliation/service.js'
import type { BreakThreshold } from '../src/reconciliation/thresholds.js'

/** No-database default (tests / local dev). */
export class InMemoryReconciliationLogStore implements ReconciliationLogStore {
  private readonly rows: StoredReconciliationRun[] = []
  async create(input: ReconciliationRunCreateInput): Promise<{ run: StoredReconciliationRun; created: boolean }> {
    const existing = this.rows.find((r) => r.run_id === input.run_id)
    if (existing) return { run: existing, created: false }
    const run: StoredReconciliationRun = {
      id: crypto.randomUUID(),
      run_id: input.run_id,
      run_type: input.run_type,
      status: input.status,
      window_start: input.window_start,
      window_end: input.window_end,
      line_count_total: input.line_count_total ?? null,
      line_count_matched: input.line_count_matched ?? null,
      line_count_unmatched: input.line_count_unmatched ?? null,
      line_count_disputed: input.line_count_disputed ?? null,
      failure_reason: input.failure_reason ?? null,
      created_at: new Date().toISOString()
    }
    this.rows.unshift(run)
    return { run, created: true }
  }
  async get(runId: string): Promise<StoredReconciliationRun | null> {
    return this.rows.find((r) => r.run_id === runId) ?? null
  }
  async countForPrefix(runIdPrefix: string): Promise<number> {
    return this.rows.filter((r) => r.run_id.startsWith(runIdPrefix)).length
  }
  async listForPrefix(runIdPrefix: string): Promise<StoredReconciliationRun[]> {
    return this.rows.filter((r) => r.run_id.startsWith(runIdPrefix)).sort((a, b) => a.window_start.localeCompare(b.window_start))
  }
  async listForRange(start: string, end: string): Promise<StoredReconciliationRun[]> {
    return this.rows.filter((r) => r.created_at >= start && r.created_at < end).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  async list(query: ReconciliationRunListQuery = {}): Promise<ReconciliationRunPage> {
    let rows = this.rows
    if (query.run_type) rows = rows.filter((r) => r.run_type === query.run_type)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

/** No-database default (tests / local dev). */
export class InMemoryReconciliationBreakStore implements ReconciliationBreakStore {
  private readonly rows: StoredReconciliationBreak[] = []
  async createMany(inputs: ReconciliationBreakCreateInput[]): Promise<StoredReconciliationBreak[]> {
    const now = new Date().toISOString()
    const created = inputs.map((input) => ({
      id: crypto.randomUUID(),
      run_id: input.run_id,
      client_id: input.client_id ?? null,
      channel: 'internal_retail',
      line_type: input.line_type,
      status: 'flagged',
      variance_amount: input.variance_amount ?? null,
      variance_count: input.variance_count ?? null,
      source_a_ref: input.source_a_ref,
      source_b_ref: input.source_b_ref,
      source_c_ref: input.source_c_ref ?? null,
      assigned_to: null,
      sla_clock_started_at: now,
      resolution_outcome: null,
      resolution_note: null,
      nebras_dispute_case_id: null,
      reopened_count: 0,
      resolved_at: null,
      created_at: now
    }))
    this.rows.unshift(...created)
    return created
  }
  async countForRun(runId: string): Promise<number> {
    return this.rows.filter((r) => r.run_id === runId).length
  }
  async get(id: string): Promise<StoredReconciliationBreak | null> {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async claim(id: string, assignedTo: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || row.status !== 'flagged') return null
    row.status = 'assigned'
    row.assigned_to = assignedTo
    row.sla_clock_started_at = new Date().toISOString()
    return row
  }
  async resolve(id: string, outcome: string, note: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || !(row.status === 'flagged' || row.status === 'assigned')) return null
    row.status = outcome
    row.resolution_outcome = outcome
    row.resolution_note = note
    row.resolved_at = new Date().toISOString()
    return row
  }
  async reopen(id: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    const terminal = new Set(['resolved_matched', 'resolved_internal_correction', 'escalated_nebras_dispute', 'escalated_fintech_billing'])
    if (!row || !terminal.has(row.status)) return null
    row.status = 'flagged'
    row.assigned_to = null
    row.resolution_outcome = null
    row.resolution_note = null
    row.sla_clock_started_at = null
    row.resolved_at = null
    row.reopened_count += 1
    return row
  }
  async escalateNebras(id: string, nebrasCaseId: string): Promise<StoredReconciliationBreak | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row || !(row.status === 'flagged' || row.status === 'assigned')) return null
    row.status = 'escalated_nebras_dispute'
    row.nebras_dispute_case_id = nebrasCaseId
    return row
  }
  async summarizeByStatus(runIdPrefix: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const r of this.rows) if (r.run_id.startsWith(runIdPrefix)) out[r.status] = (out[r.status] ?? 0) + 1
    return out
  }
  async listForRange(start: string, end: string): Promise<StoredReconciliationBreak[]> {
    return this.rows.filter((r) => r.created_at >= start && r.created_at < end).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  async list(query: ReconciliationBreakListQuery = {}): Promise<ReconciliationBreakPage> {
    let rows = this.rows
    if (query.run_id) rows = rows.filter((r) => r.run_id === query.run_id)
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    if (query.line_type) rows = rows.filter((r) => r.line_type === query.line_type)
    if (query.client_id) rows = rows.filter((r) => r.client_id === query.client_id)
    return { rows: rows.slice(0, Math.min(Math.max(query.limit ?? 50, 1), 200)), next_cursor: null }
  }
}

/**
 * BACKOFFICE-12 — in-memory thresholds for the demo default + tests. Mirrors the
 * Pg store: upsert per fee class, list returns the current overrides (the service
 * overlays them on the engine defaults).
 */
export class InMemoryReconciliationThresholdStore implements ThresholdStore {
  private readonly byClass = new Map<string, BreakThreshold>()
  async list(): Promise<BreakThreshold[]> {
    return [...this.byClass.values()]
  }
  async replaceAll(thresholds: BreakThreshold[], _updatedBy: string, _traceId: string): Promise<BreakThreshold[]> {
    for (const t of thresholds) this.byClass.set(t.fee_class, { fee_class: t.fee_class, threshold_value: t.threshold_value, unit: t.unit })
    return [...this.byClass.values()]
  }
}
