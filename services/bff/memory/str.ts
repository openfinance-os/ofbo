// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/str/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { StrDraft, StrDraftListQuery, StrDraftPage, StrDraftRecordInput, StrDraftStatus, StrDraftStore, StrStatusPatch } from '../src/str/service.js'

// CODE-02 — moved with its only caller (the store below).
const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')

/**
 * No-database default (tests / demo profile). The worker wires a durable Pg store (RLS +
 * 24/60 retention + BCBS 239 lineage) at the M-tier follow-up — the service depends only on
 * the interface. Optionally seeds a couple of synthetic demo drafts so the list is non-empty.
 */
export class InMemoryStrDraftStore implements StrDraftStore {
  private readonly rows: StrDraft[] = []
  constructor(opts: { seedDemo?: boolean } = {}) {
    if (opts.seedDemo) {
      // Deterministic synthetic demo drafts (fixed UUIDs, no PII) so the STR queue is populated.
      this.rows.push(
        this.make('5f0e63c0-0000-4000-8000-0000000000a1', 'consent-demo-7741', 'Velocity anomaly: 6 revoke+re-grant cycles in 24h (synthetic).', 'demo:risk-analyst', '2026-06-20T08:00:00.000Z'),
        this.make('5f0e63c0-0000-4000-8000-0000000000a2', 'consent-demo-8852', 'CoP mismatch cluster across 3 fintechs (synthetic).', 'demo:risk-analyst', '2026-06-21T09:30:00.000Z')
      )
    }
  }
  private make(id: string, consentId: string, ctx: string, by: string, at: string): StrDraft {
    return { str_draft_id: id, source_consent_id: consentId, case_context: ctx, status: 'draft', created_by: by, approval_id: null, workflow_ref: null, approved_by: null, handed_off_at: null, created_at: at }
  }
  async record(input: StrDraftRecordInput, _traceId?: string): Promise<StrDraft> {
    const draft: StrDraft = {
      str_draft_id: crypto.randomUUID(),
      source_consent_id: input.source_consent_id,
      case_context: input.case_context,
      status: 'draft',
      created_by: input.created_by,
      approval_id: null,
      workflow_ref: null,
      approved_by: null,
      handed_off_at: null,
      created_at: new Date().toISOString()
    }
    this.rows.push(draft)
    return draft
  }
  async get(id: string): Promise<StrDraft | null> {
    return this.rows.find((r) => r.str_draft_id === id) ?? null
  }
  async list(query: StrDraftListQuery = {}): Promise<StrDraftPage> {
    let rows = [...this.rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (query.status) rows = rows.filter((r) => r.status === query.status)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const slice = rows.slice(0, limit)
    const last = slice[slice.length - 1]
    const hasMore = rows.length > limit
    return { rows: slice, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.str_draft_id) : null }
  }
  async markStatus(id: string, status: StrDraftStatus, patch: StrStatusPatch, _traceId?: string): Promise<StrDraft | null> {
    const r = this.rows.find((x) => x.str_draft_id === id)
    if (!r) return null
    r.status = status
    if (patch.approval_id !== undefined) r.approval_id = patch.approval_id
    if (patch.workflow_ref !== undefined) r.workflow_ref = patch.workflow_ref
    if (patch.approved_by !== undefined) r.approved_by = patch.approved_by
    if (patch.handed_off_at !== undefined) r.handed_off_at = patch.handed_off_at
    return r
  }
}
