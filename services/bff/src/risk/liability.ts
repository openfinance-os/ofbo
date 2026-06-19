import type { Context } from 'hono'
import type { ItsmPort } from '@ofbo/ports'
import type { LiabilityMonitor } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope, ScopeDeniedError, scopeDenialEnvelope } from '../rbac.js'
import { dataEnvelope } from '../envelope.js'
import { liveFreshness, type FreshnessEnvelope } from '../analytics/freshness.js'

/**
 * BACKOFFICE-36 — proactive Nebras-liability event monitor (threshold-based). The
 * Limitation of Liability Model v2.1 amounts (AED), keyed issue × liable party
 * (LFI or TPP — the bank plays both roles). The monitor ingests liability events
 * (LFI- and TPP-side), accrues per issue × party, and when accrual crosses the
 * configurable per-class threshold raises a nebras_liability_approach risk signal
 * (ref = issue|party|AED) + a P3 ITSM ticket to Risk AND Ops. The read view
 * (risk:read) surfaces the matrix + approaching triggers. Deterministic / synthetic.
 */

export const LIABILITY_MONITOR_SCOPE = 'risk:read'
export type LiableParty = 'LFI' | 'TPP'

/** v2.1 per-incident scheme amounts (AED). */
export const LIABILITY_MATRIX: Record<string, number> = {
  consent_state_failure: 500,
  revocation_failure: 350,
  sca_auth_error: 500,
  data_breach: 750,
  sla_execution_failure: 350, // tiered by delay — see SLA_TIERS
  consumer_protection_violation: 1000,
  deprecation_mismanagement: 2500,
  lfi_breaking_change: 5000,
  fraud_prevention_failure: 10000
}
/** SLA-execution failure is tiered 350/250/200 by delay severity (v2.1). */
export const SLA_TIERS: Record<number, number> = { 1: 350, 2: 250, 3: 200 }

export interface LiabilityEvent {
  issue: string
  liable_party: LiableParty
  incident_count: number
  sla_tier?: number
}

export function liabilityAmount(event: { issue: string; sla_tier?: number }): number {
  if (event.issue === 'sla_execution_failure') return SLA_TIERS[event.sla_tier ?? 1] ?? SLA_TIERS[1]!
  return LIABILITY_MATRIX[event.issue] ?? 0
}
function severityFor(accruedAed: number): 'low' | 'medium' | 'high' | 'critical' {
  if (accruedAed >= 5000) return 'critical'
  if (accruedAed >= 1000) return 'high'
  if (accruedAed >= 500) return 'medium'
  return 'low'
}
const itsmSeverity = (s: 'low' | 'medium' | 'high' | 'critical') => s

export interface LiabilitySignalSink {
  record(event: { signal_type: string; severity: string; acting_principal: string; summary: string; trace_id: string; nebras_liability_event_ref?: string }): Promise<void>
}
export interface RiskLiabilityReader {
  liabilityMonitor(): Promise<LiabilityMonitor>
}
export interface LiabilityEventSource {
  getLiabilityEvents(): Promise<LiabilityEvent[]>
}

const RUN_PRINCIPAL = 'system:liability-monitor'

export interface LiabilityMonitorDeps {
  signals: LiabilitySignalSink
  itsm: Pick<ItsmPort, 'createTicket'>
  /** Per-class alert thresholds in AED (default = the v2.1 per-incident amount). */
  thresholds?: Record<string, number>
  now?: () => Date
}

/** BACKOFFICE-65 — optional predictive forecast folded into the liability view. Typed
 *  structurally to avoid a circular import with liability-forecast.ts. */
export interface LiabilityForecastProvider {
  forecastView(): Promise<unknown>
}

export interface LiabilityViewDeps {
  riskMetrics: RiskLiabilityReader
  forecast?: LiabilityForecastProvider
  now?: () => Date
}

export interface EvaluatedSignal {
  issue: string
  liable_party: LiableParty
  accrued_aed: number
  severity: string
  ref: string
  emitted: boolean
}

export class LiabilityMonitorService {
  constructor(private readonly deps: LiabilityMonitorDeps) {}

  /**
   * Evaluate liability events against the matrix + per-class thresholds. Emits a
   * nebras_liability_approach signal + a P3 ITSM ticket to Risk AND Ops for each
   * (issue × party) that crosses its threshold and has no OPEN signal yet (dedup).
   */
  async evaluate(events: LiabilityEvent[], openRefs: Set<string>, traceId: string): Promise<EvaluatedSignal[]> {
    const out: EvaluatedSignal[] = []
    for (const e of events) {
      const accrued = liabilityAmount(e) * Math.max(e.incident_count, 0)
      const ref = `${e.issue}|${e.liable_party}|${accrued}`
      const threshold = this.deps.thresholds?.[e.issue] ?? liabilityAmount(e)
      const crosses = accrued >= threshold
      if (!crosses || openRefs.has(ref)) {
        out.push({ issue: e.issue, liable_party: e.liable_party, accrued_aed: accrued, severity: severityFor(accrued), ref, emitted: false })
        continue
      }
      const severity = severityFor(accrued)
      const summary = `Nebras liability approaching: ${e.issue} (${e.liable_party}) accrued AED ${accrued}`
      await this.deps.signals.record({ signal_type: 'nebras_liability_approach', severity, acting_principal: RUN_PRINCIPAL, summary, trace_id: traceId, nebras_liability_event_ref: ref })
      // ITSM to Risk AND Ops (PRD §7 BACKOFFICE-36).
      await this.deps.itsm.createTicket({ type: 'nebras_liability_approach', severity: itsmSeverity(severity), team: 'risk', summary }, { trace_id: traceId })
      await this.deps.itsm.createTicket({ type: 'nebras_liability_approach', severity: itsmSeverity(severity), team: 'payment_operations', summary }, { trace_id: traceId })
      openRefs.add(ref)
      out.push({ issue: e.issue, liable_party: e.liable_party, accrued_aed: accrued, severity, ref, emitted: true })
    }
    return out
  }
}

export class LiabilityViewService {
  private readonly now: () => Date
  constructor(private readonly deps: LiabilityViewDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, LIABILITY_MONITOR_SCOPE)
    const monitor = await this.deps.riskMetrics.liabilityMonitor()
    // accrual breakdown parsed from the open signals' refs (issue|party|aed)
    const accrual: { issue: string; liable_party: string; accrued_aed: number; severity: string; created_at: string }[] = []
    for (const s of monitor.recent) {
      const [issue, party, aed] = (s.nebras_liability_event_ref ?? '').split('|')
      if (issue && party) accrual.push({ issue, liable_party: party, accrued_aed: Number(aed) || 0, severity: s.severity, created_at: s.created_at })
    }
    const data: Record<string, unknown> = {
      liability_matrix: { per_incident_aed: LIABILITY_MATRIX, sla_execution_tiers_aed: SLA_TIERS },
      open_count: monitor.open_count,
      by_severity: monitor.by_severity,
      approaching_triggers: accrual
    }
    // BACKOFFICE-65 — fold in the 24h predictive forecast (regulated AI artefact) when wired.
    if (this.deps.forecast) data.forecast = await this.deps.forecast.forecastView()
    // BACKOFFICE-40 — live read over risk_signal → trivially fresh.
    return { data, freshness: liveFreshness(this.now()) }
  }
}

/** Deterministic demo liability events (LFI- and TPP-side) for the scheduled monitor. */
export class DemoLiabilityEventSource implements LiabilityEventSource {
  async getLiabilityEvents(): Promise<LiabilityEvent[]> {
    return [
      { issue: 'consent_state_failure', liable_party: 'LFI', incident_count: 1 },
      { issue: 'sla_execution_failure', liable_party: 'LFI', incident_count: 1, sla_tier: 1 },
      { issue: 'fraud_prevention_failure', liable_party: 'TPP', incident_count: 1 }
    ]
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function liabilityMonitorRoutes(service: LiabilityViewService): Record<string, Handler> {
  return {
    'get /back-office/analytics/nebras-liability-monitor': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'))
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        if (e instanceof ScopeDeniedError) return c.json(scopeDenialEnvelope(e.required), 403)
        throw e
      }
    }
  }
}
