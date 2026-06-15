import { createHash } from 'node:crypto'
import type { ConsentChurnRow, AgentLookupRow } from '@ofbo/db'
import type { ItsmPort } from '@ofbo/ports'

/**
 * BACKOFFICE-37 / -46 — streaming audit-pattern anomaly detection + ITSM escalation.
 * A windowed scan over audit_high_sensitivity flags: consent revoke+re-grant >5×/24h
 * per PSU (consent_anomaly); >100 PSU lookups/agent/hour, repeated authorization
 * denials, and off-hours admin activity (agent_anomaly). Each crossing emits a Risk
 * signal with context (session flagged), deduped across runs by a key in signal_data,
 * and — when an ITSM port is wired (BACKOFFICE-46) — raises a P3 ticket with team
 * routing, plus a parallel page for severity-critical. No raw PSU PII: churn carries a
 * hashed PSU ref; agent signals carry the agent subject (an internal id, not a PSU).
 */

export const DEFAULT_ANOMALY_THRESHOLDS = {
  consent_churn_per_psu_24h: 5,
  lookups_per_agent_1h: 100,
  scope_denials_per_agent_1h: 10,
  off_hours_admin_per_agent_24h: 15
}

export interface AnomalySignalSink {
  record(event: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; dedup_key?: string; context?: Record<string, unknown> }): Promise<void>
}
export interface AnomalyDetectionReader {
  consentChurnByPsu(sinceIso: string): Promise<ConsentChurnRow[]>
  lookupCountByAgent(sinceIso: string): Promise<AgentLookupRow[]>
  scopeDenialsByAgent(sinceIso: string): Promise<AgentLookupRow[]>
  offHoursAdminByAgent(sinceIso: string): Promise<AgentLookupRow[]>
  openAnomalyDedupKeys(): Promise<Set<string>>
}

type AnomalyThresholds = Partial<typeof DEFAULT_ANOMALY_THRESHOLDS>

export interface ConsentAnomalyDeps {
  detection: AnomalyDetectionReader
  signals: AnomalySignalSink
  /** BACKOFFICE-46 — P3 ITSM escalation (omit to detect/emit signals only). */
  itsm?: Pick<ItsmPort, 'createTicket'>
  thresholds?: AnomalyThresholds
  now?: () => Date
}

export type AnomalyRule = 'consent_churn' | 'agent_lookups' | 'repeated_403s' | 'off_hours_admin'
export interface DetectedAnomaly {
  rule: AnomalyRule
  subject_ref: string
  count: number
  severity: string
  emitted: boolean
  ticketed: boolean
  paged: boolean
}

const psuRef = (psu: string): string => createHash('sha256').update(psu).digest('hex').slice(0, 16)
const RUN_PRINCIPAL = 'system:consent-anomaly-detector'
type Severity = 'medium' | 'high' | 'critical'
/** BACKOFFICE-46 — team routing per anomaly class. */
const RULE_TEAM: Record<AnomalyRule, string> = { consent_churn: 'risk', agent_lookups: 'risk', repeated_403s: 'security', off_hours_admin: 'security' }
/** Severity by how far over the threshold (1× → base, 2× → high, 3×+ → critical). */
function severityBy(count: number, threshold: number, base: Severity): Severity {
  if (count > threshold * 3) return 'critical'
  if (count > threshold * 2) return 'high'
  return base
}

export class ConsentAnomalyDetector {
  private readonly now: () => Date
  private readonly t: typeof DEFAULT_ANOMALY_THRESHOLDS
  constructor(private readonly deps: ConsentAnomalyDeps) {
    this.now = deps.now ?? (() => new Date())
    this.t = { ...DEFAULT_ANOMALY_THRESHOLDS, ...deps.thresholds }
  }

  async detect(traceId: string): Promise<DetectedAnomaly[]> {
    const now = this.now().getTime()
    const h1 = new Date(now - 3600 * 1000).toISOString()
    const h24 = new Date(now - 24 * 3600 * 1000).toISOString()
    const openKeys = await this.deps.detection.openAnomalyDedupKeys()
    const out: DetectedAnomaly[] = []

    const handle = async (
      rule: AnomalyRule,
      subjectRef: string,
      count: number,
      crosses: boolean,
      severity: Severity,
      signalType: 'consent_anomaly' | 'agent_anomaly',
      summary: string,
      dedupKey: string,
      context: Record<string, unknown>,
      actingPrincipal: string
    ): Promise<void> => {
      if (!crosses || openKeys.has(dedupKey)) {
        out.push({ rule, subject_ref: subjectRef, count, severity, emitted: false, ticketed: false, paged: false })
        return
      }
      await this.deps.signals.record({ signal_type: signalType, severity, acting_principal: actingPrincipal, summary, trace_id: traceId, dedup_key: dedupKey, context: { session_flagged: true, ...context } })
      let ticketed = false
      let paged = false
      if (this.deps.itsm) {
        await this.deps.itsm.createTicket({ type: 'audit_anomaly', severity, team: RULE_TEAM[rule], summary }, { trace_id: traceId })
        ticketed = true
        if (severity === 'critical') {
          await this.deps.itsm.createTicket({ type: 'audit_anomaly_page', severity: 'critical', team: 'on_call', summary: `PAGE: ${summary}` }, { trace_id: traceId })
          paged = true
        }
      }
      openKeys.add(dedupKey)
      out.push({ rule, subject_ref: subjectRef, count, severity, emitted: true, ticketed, paged })
    }

    // consent churn (per PSU, 24h)
    for (const r of await this.deps.detection.consentChurnByPsu(h24)) {
      const ref = psuRef(r.psu_identifier)
      await handle('consent_churn', ref, r.cycles, r.cycles > this.t.consent_churn_per_psu_24h, severityBy(r.cycles, this.t.consent_churn_per_psu_24h, 'medium'), 'consent_anomaly', `Consent churn anomaly: a PSU revoked+re-granted ${r.cycles}× in 24h (>${this.t.consent_churn_per_psu_24h}) — session flagged`, `consent_churn|${ref}`, { churn_cycles: r.cycles, psu_ref: ref }, RUN_PRINCIPAL)
    }
    // PSU-lookup volume (per agent, 1h)
    for (const r of await this.deps.detection.lookupCountByAgent(h1)) {
      await handle('agent_lookups', r.agent, r.lookups, r.lookups > this.t.lookups_per_agent_1h, severityBy(r.lookups, this.t.lookups_per_agent_1h, 'high'), 'agent_anomaly', `Excessive PSU lookups: ${r.lookups} in 1h (>${this.t.lookups_per_agent_1h}) by ${r.agent} — session flagged`, `agent_lookups|${r.agent}`, { lookup_count: r.lookups }, r.agent)
    }
    // repeated authorization denials (per agent, 1h)
    for (const r of await this.deps.detection.scopeDenialsByAgent(h1)) {
      await handle('repeated_403s', r.agent, r.lookups, r.lookups > this.t.scope_denials_per_agent_1h, severityBy(r.lookups, this.t.scope_denials_per_agent_1h, 'high'), 'agent_anomaly', `Repeated authorization denials: ${r.lookups} 403s in 1h (>${this.t.scope_denials_per_agent_1h}) by ${r.agent} — session flagged`, `repeated_403s|${r.agent}`, { denial_count: r.lookups }, r.agent)
    }
    // off-hours admin activity (per agent, 24h)
    for (const r of await this.deps.detection.offHoursAdminByAgent(h24)) {
      await handle('off_hours_admin', r.agent, r.lookups, r.lookups > this.t.off_hours_admin_per_agent_24h, severityBy(r.lookups, this.t.off_hours_admin_per_agent_24h, 'medium'), 'agent_anomaly', `Off-hours admin activity: ${r.lookups} admin actions outside business hours (>${this.t.off_hours_admin_per_agent_24h}) by ${r.agent} — session flagged`, `off_hours_admin|${r.agent}`, { off_hours_count: r.lookups }, r.agent)
    }
    return out
  }
}
