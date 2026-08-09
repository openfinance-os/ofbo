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
  async listPending() {
    return [...this.rows.values()].filter((r) => r.state === 'pending').map((r) => structuredClone(r))
  }
}
