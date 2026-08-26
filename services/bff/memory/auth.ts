// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/auth.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { AuthAuditEvent, AuthAuditSink } from '../src/auth.js'

export class InMemoryAuthAuditSink implements AuthAuditSink {
  readonly events: AuthAuditEvent[] = []
  async record(event: AuthAuditEvent): Promise<void> {
    this.events.push(event)
  }
}
