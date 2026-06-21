import { createHash } from 'node:crypto'
import { generateDemoDataset } from '@ofbo/synthetic-data'
import type { NebrasEgressPort, TraceContext } from '@ofbo/ports'

/**
 * DEMO-01 — consent-drift monitor. Reads each watched consent's CURRENT status from the Nebras
 * Consent Manager (via the P6 egress port) and compares it to the platform's mirror; a mismatch
 * — the Hub reports a state the platform doesn't hold — is a `consent_anomaly` Risk signal. This
 * is what makes the simulator's injectable `consent_drift` fault a live, on-demand lever: with no
 * fault the Hub agrees with the dataset (no signal); inject drift on a revoked consent and the
 * Hub reports it Authorized → drift fires. Deduped across runs by a key in signal_data. No PSU
 * PII (the PSU is a hashed ref).
 */

export interface ConsentDriftSignalSink {
  record(event: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; dedup_key?: string; context?: Record<string, unknown> }): Promise<void>
}

export interface WatchedConsent {
  consent_id: string
  /** The status the platform holds for this consent (its mirror). */
  expected_status: string
  /** Hashed PSU ref (no raw PSU PII in the signal). */
  psu_ref?: string
}

export interface ConsentDriftWatchSource {
  watched(): Promise<WatchedConsent[]>
}

export interface ConsentDriftDeps {
  egress: Pick<NebrasEgressPort, 'getConsentStatus'>
  signals: ConsentDriftSignalSink
  source: ConsentDriftWatchSource
  /** Optional open-signal dedup (PgAnomalyDetectionStore) so re-runs don't duplicate. */
  dedup?: { openAnomalyDedupKeys(): Promise<Set<string>> }
}

const RUN_PRINCIPAL = 'system:consent-drift-monitor'

export class ConsentDriftMonitor {
  constructor(private readonly deps: ConsentDriftDeps) {}

  async detect(traceId: string): Promise<{ checked: number; drifted: number; emitted: number }> {
    const watched = await this.deps.source.watched()
    const open = this.deps.dedup ? await this.deps.dedup.openAnomalyDedupKeys() : new Set<string>()
    let drifted = 0
    let emitted = 0
    for (const w of watched) {
      const hub = await this.deps.egress.getConsentStatus(w.consent_id, { trace_id: traceId } as TraceContext)
      if (hub.status === w.expected_status) continue
      drifted++
      const dedupKey = `consent_drift|${w.consent_id}`
      if (open.has(dedupKey)) continue
      await this.deps.signals.record({
        signal_type: 'consent_anomaly',
        severity: 'high',
        acting_principal: RUN_PRINCIPAL,
        summary: `Consent drift: the Nebras Consent Manager reports '${hub.status}' for a consent the platform holds as '${w.expected_status}' (${w.consent_id}) — session flagged`,
        trace_id: traceId,
        dedup_key: dedupKey,
        context: {
          session_flagged: true,
          rule: 'consent_drift',
          hub_status: hub.status,
          expected_status: w.expected_status,
          consent_id: w.consent_id,
          ...(w.psu_ref ? { psu_ref: w.psu_ref } : {})
        }
      })
      open.add(dedupKey)
      emitted++
    }
    return { checked: watched.length, drifted, emitted }
  }
}

const psuRef = (psu: string): string => createHash('sha256').update(psu).digest('hex').slice(0, 16)

/**
 * Demo watch list: the synthetic dataset's Revoked consents (the platform mirror holds these as
 * 'Revoked'). With no fault the Hub agrees; `pnpm demo:fault consent-drift <id>` on one of these
 * makes the Hub report it 'Authorized' → a drift signal. Deterministic (same dataset seed).
 */
export class DemoConsentDriftSource implements ConsentDriftWatchSource {
  async watched(): Promise<WatchedConsent[]> {
    const out: WatchedConsent[] = []
    for (const psu of generateDemoDataset().psus) {
      for (const c of psu.consents) {
        if (c.status === 'Revoked') out.push({ consent_id: c.consent_id, expected_status: 'Revoked', psu_ref: psuRef(psu.bank_customer_id) })
      }
    }
    return out
  }
}
