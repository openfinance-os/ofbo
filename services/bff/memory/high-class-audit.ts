// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/high-class-audit.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { HighClassAuditEvent, HighClassAuditSink } from '../src/high-class-audit.js'


export class InMemoryHighClassAuditSink implements HighClassAuditSink {
  readonly events: HighClassAuditEvent[] = []
  async emit(event: HighClassAuditEvent): Promise<void> {
    this.events.push(event)
  }
}
