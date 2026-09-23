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
  async recordOnce(
    event: RiskSignalEvent & { dedup_key: string },
    sinceIso: string,
    onFirst?: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    const since = Date.parse(sinceIso)
    const seen = this.signals.some(
      (s, i) => s.signal_type === event.signal_type && s.dedup_key === event.dedup_key && this.recordedAt[i]! >= since
    )
    if (seen) return false
    // Claim the slot synchronously (the Pg emitter holds an advisory lock for the same purpose) and
    // give it back if the pre-insert step fails, so nothing is recorded and a retry can run.
    const slot: RiskSignalEvent = { ...event }
    this.signals.push(slot)
    this.recordedAt.push(Date.now())
    try {
      Object.assign(slot, await onFirst?.())
    } catch (e) {
      const i = this.signals.indexOf(slot)
      this.signals.splice(i, 1)
      this.recordedAt.splice(i, 1)
      throw e
    }
    return true
  }
}
