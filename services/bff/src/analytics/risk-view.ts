import type { Context } from 'hono'
import type { RiskSignalSummary, LiabilityMonitor, RiskSignalHeader, GovernedReadContext } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope } from '../envelope.js'
import { liveFreshness, type FreshnessEnvelope } from './freshness.js'

/**
 * BACKOFFICE-30 — Risk View. A read-only analytics view (risk:read, enforced at the
 * BFF middleware AND re-checked here) over risk_signal: consent anomaly signals
 * (frequency, platform↔Nebras drift), TPP behavioural anomalies (volume spikes,
 * off-pattern timing, CoP mismatch trends), and the proactive Nebras-liability
 * monitor — with the freshness envelope (BACKOFFICE-40). Surfaces typed signal
 * headers + counts only, never the raw signal_data blob (no PSU PII). The
 * threshold-based liability-event engine (BACKOFFICE-36) and streaming consent
 * anomaly detection (BACKOFFICE-37) feed this view; they are separate stories.
 */

export const RISK_VIEW_SCOPE = 'risk:read'

const CONSENT_ANOMALY_TYPES = ['consent_anomaly', 'cop_mismatch_spike']
const TPP_ANOMALY_TYPES = ['tpp_behaviour', 'agent_anomaly']

export interface RiskMetricsReader {
  summary(ctx?: GovernedReadContext): Promise<RiskSignalSummary>
  liabilityMonitor(ctx?: GovernedReadContext): Promise<LiabilityMonitor>
  recentActive(limit?: number): Promise<RiskSignalHeader[]>
}

export interface RiskViewDeps {
  metrics: RiskMetricsReader
  now?: () => Date
}

const sumTypes = (by: Record<string, number>, types: string[]) => types.reduce((n, t) => n + (by[t] ?? 0), 0)

export class RiskViewService {
  constructor(private readonly deps: RiskViewDeps) {}

  async view(principal: Principal, traceId: string): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, RISK_VIEW_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()

    // Cross-fintech aggregate reads are purpose-gated + High-class logged via the governed path
    // (BACKOFFICE-33, purpose risk_monitoring); the recent-active list stays a tenant-scoped read.
    const ctx: GovernedReadContext = { actingPrincipal: principal.subject, actingPersona: principal.persona, scopeUsed: RISK_VIEW_SCOPE, traceId }

    const [summary, liability, recent] = await Promise.all([
      this.deps.metrics.summary(ctx),
      this.deps.metrics.liabilityMonitor(ctx),
      this.deps.metrics.recentActive(20)
    ])

    // UIF-04 (ADR 0016 D1) — typed sections the portal renders as bespoke panels; live data.
    const severitySegments = Object.entries(summary.by_severity)
      .map(([label, value]) => ({ label, value }))
      .filter((seg) => seg.value > 0)
    const sections: Record<string, unknown>[] = [
      {
        kind: 'kpi-strip',
        title: 'Risk Signals',
        stats: [
          { label: 'Active signals', value: String(summary.active_total) },
          { label: 'Consent anomalies', value: String(sumTypes(summary.by_type, CONSENT_ANOMALY_TYPES)) },
          { label: 'TPP behaviour anomalies', value: String(sumTypes(summary.by_type, TPP_ANOMALY_TYPES)) }
        ]
      }
    ]
    if (severitySegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'Open Signals by Severity', segments: severitySegments })

    const data = {
      signal_summary: { active_total: summary.active_total, by_type: summary.by_type, by_severity: summary.by_severity, by_status: summary.by_status },
      consent_anomalies: { active: sumTypes(summary.by_type, CONSENT_ANOMALY_TYPES) },
      tpp_behaviour_anomalies: { active: sumTypes(summary.by_type, TPP_ANOMALY_TYPES) },
      liability_monitor: liability,
      recent_signals: recent,
      sections
    }
    // BACKOFFICE-40 — live read over risk_signal → trivially fresh.
    return { data, freshness: liveFreshness(now) }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function riskViewRoutes(service: RiskViewService): Record<string, Handler> {
  return {
    'get /back-office/analytics/risk-view': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'), c.req.header('x-fapi-interaction-id') ?? 'unknown')
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        throw e
      }
    }
  }
}
