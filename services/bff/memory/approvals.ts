// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/approvals/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { ApprovalRecord, ApprovalStore } from '../src/approvals/service.js'

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, ApprovalRecord>()
  async create(r: ApprovalRecord) {
    this.rows.set(r.approval_request_id, structuredClone(r))
  }
  async get(id: string) {
    const r = this.rows.get(id)
    return r ? structuredClone(r) : null
  }
  async update(r: ApprovalRecord) {
    this.rows.set(r.approval_request_id, structuredClone(r))
  }
  async claimForApproval(id: string, approver: string, approvedAt: string) {
    const r = this.rows.get(id)
    // Read-check-write with no await between the three, so it is atomic on this runtime the same
    // way the Postgres store's single conditional UPDATE is atomic on the database. The
    // conditional is the whole point: a second claimant sees `approved`, not `pending`.
    if (!r || r.state !== 'pending') return false
    r.state = 'approved'
    r.approver = approver
    // Write-once, mirroring the COALESCE in the Postgres store: approved_at is four-eyes timing
    // evidence, and a later write must not be able to restamp it.
    r.approved_at = r.approved_at ?? approvedAt
    return true
  }
  async listPending() {
    return [...this.rows.values()].filter((r) => r.state === 'pending').map((r) => structuredClone(r))
  }
}
