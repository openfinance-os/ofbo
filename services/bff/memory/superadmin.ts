// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/superadmin.ts.
// Behaviour unchanged apart from recordOnce (the durable BACKOFFICE-80 session dedupe); see ./README.md for why they live outside src/.
import type { RiskSignalEvent, RiskSignalSink } from '../src/superadmin.js'

export class InMemoryRiskSignalSink implements RiskSignalSink {
  readonly signals: RiskSignalEvent[] = []
  private readonly recordedAt: number[] = []
  async record(event: RiskSignalEvent): Promise<void> {
    this.signals.push(event)
    this.recordedAt.push(Date.now())
  }
  /** Same contract as PgRiskSignalEmitter.recordOnce — one signal per dedup key per window. */
  async recordOnce(event: RiskSignalEvent & { dedup_key: string }, sinceIso: string): Promise<boolean> {
    const since = Date.parse(sinceIso)
    const seen = this.signals.some(
      (s, i) => s.signal_type === event.signal_type && s.dedup_key === event.dedup_key && this.recordedAt[i]! >= since
    )
    if (seen) return false
    await this.record(event)
    return true
  }
}
