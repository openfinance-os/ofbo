import { createHash } from 'node:crypto'
import type { ConsentChurnRow, AgentLookupRow } from '@ofbo/db'

/**
 * BACKOFFICE-37 — streaming consent-pattern anomaly detection. A windowed scan over
 * audit_high_sensitivity flags: (a) a PSU revoking + re-granting consent >5×/24h →
 * consent_anomaly; (b) an agent doing >100 PSU lookups/hour → agent_anomaly. Each
 * crossing emits a Risk signal with context (session flagged), deduped across runs by
 * a key in signal_data. No raw PSU PII: the churn signal carries a hashed PSU ref +
 * counts only; agent signals carry the agent subject (an internal id, not a PSU). The
 * signals surface in the Risk View (-30) and risk-signals endpoints; ITSM routing for
 * these patterns is BACKOFFICE-46.
 */

export const DEFAULT_ANOMALY_THRESHOLDS = { consent_churn_per_psu_24h: 5, lookups_per_agent_1h: 100 }

export interface AnomalySignalSink {
  record(event: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; dedup_key?: string; context?: Record<string, unknown> }): Promise<void>
}
export interface AnomalyDetectionReader {
  consentChurnByPsu(sinceIso: string): Promise<ConsentChurnRow[]>
  lookupCountByAgent(sinceIso: string): Promise<AgentLookupRow[]>
  openAnomalyDedupKeys(): Promise<Set<string>>
}

export interface ConsentAnomalyDeps {
  detection: AnomalyDetectionReader
  signals: AnomalySignalSink
  thresholds?: { consent_churn_per_psu_24h?: number; lookups_per_agent_1h?: number }
  now?: () => Date
}

export interface DetectedAnomaly {
  rule: 'consent_churn' | 'agent_lookups'
  subject_ref: string
  count: number
  severity: string
  emitted: boolean
}

const psuRef = (psu: string): string => createHash('sha256').update(psu).digest('hex').slice(0, 16)
const RUN_PRINCIPAL = 'system:consent-anomaly-detector'

export class ConsentAnomalyDetector {
  private readonly now: () => Date
  private readonly churnThreshold: number
  private readonly lookupThreshold: number
  constructor(private readonly deps: ConsentAnomalyDeps) {
    this.now = deps.now ?? (() => new Date())
    this.churnThreshold = deps.thresholds?.consent_churn_per_psu_24h ?? DEFAULT_ANOMALY_THRESHOLDS.consent_churn_per_psu_24h
    this.lookupThreshold = deps.thresholds?.lookups_per_agent_1h ?? DEFAULT_ANOMALY_THRESHOLDS.lookups_per_agent_1h
  }

  async detect(traceId: string): Promise<DetectedAnomaly[]> {
    const now = this.now().getTime()
    const churnSince = new Date(now - 24 * 3600 * 1000).toISOString()
    const lookupSince = new Date(now - 3600 * 1000).toISOString()
    const openKeys = await this.deps.detection.openAnomalyDedupKeys()
    const out: DetectedAnomaly[] = []

    for (const row of await this.deps.detection.consentChurnByPsu(churnSince)) {
      const crosses = row.cycles > this.churnThreshold
      const dedupKey = `consent_churn|${psuRef(row.psu_identifier)}`
      if (!crosses || openKeys.has(dedupKey)) {
        out.push({ rule: 'consent_churn', subject_ref: psuRef(row.psu_identifier), count: row.cycles, severity: 'medium', emitted: false })
        continue
      }
      const severity = row.cycles > this.churnThreshold * 2 ? 'high' : 'medium'
      await this.deps.signals.record({
        signal_type: 'consent_anomaly',
        severity,
        acting_principal: RUN_PRINCIPAL,
        summary: `Consent churn anomaly: a PSU revoked+re-granted ${row.cycles}× in 24h (>${this.churnThreshold}) — session flagged`,
        trace_id: traceId,
        dedup_key: dedupKey,
        context: { session_flagged: true, churn_cycles: row.cycles, psu_ref: psuRef(row.psu_identifier) }
      })
      openKeys.add(dedupKey)
      out.push({ rule: 'consent_churn', subject_ref: psuRef(row.psu_identifier), count: row.cycles, severity, emitted: true })
    }

    for (const row of await this.deps.detection.lookupCountByAgent(lookupSince)) {
      const crosses = row.lookups > this.lookupThreshold
      const dedupKey = `agent_lookups|${row.agent}`
      if (!crosses || openKeys.has(dedupKey)) {
        out.push({ rule: 'agent_lookups', subject_ref: row.agent, count: row.lookups, severity: 'high', emitted: false })
        continue
      }
      await this.deps.signals.record({
        signal_type: 'agent_anomaly',
        severity: 'high',
        acting_principal: row.agent,
        summary: `Excessive PSU lookups: ${row.lookups} in 1h (>${this.lookupThreshold}) by ${row.agent} — session flagged`,
        trace_id: traceId,
        dedup_key: dedupKey,
        context: { session_flagged: true, lookup_count: row.lookups }
      })
      openKeys.add(dedupKey)
      out.push({ rule: 'agent_lookups', subject_ref: row.agent, count: row.lookups, severity: 'high', emitted: true })
    }
    return out
  }
}
