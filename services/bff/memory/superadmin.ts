// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/superadmin.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { RiskSignalEvent, RiskSignalSink } from '../src/superadmin.js'

export class InMemoryRiskSignalSink implements RiskSignalSink {
  readonly signals: RiskSignalEvent[] = []
  async record(event: RiskSignalEvent): Promise<void> {
    this.signals.push(event)
  }
}
