import type { Context } from 'hono'
import type { ConsentVolumes, DisputeBacklog, RiskSignalBacklog, ReportLibrary, RetentionStatusRow } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope } from '../envelope.js'
import { liveFreshness, type FreshnessEnvelope } from './freshness.js'

/**
 * BACKOFFICE-29 — Compliance View. A read-only analytics view (compliance:reports:read,
 * enforced at the BFF middleware AND re-checked here) over existing regulated tables:
 * consent volumes, retention posture (full hot/warm/immutable lifecycle, BACKOFFICE-14),
 * the dispute backlog, the open risk-signal backlog, and the report library + inquiry
 * history — plus residency posture and a one-click periodic-report-generation deep-link,
 * with the mandatory freshness envelope (BACKOFFICE-40). Aggregate counts only, no PSU PII.
 * Formal STR drafting (BACKOFFICE-37) and the CBUAE release-calendar gap (BACKOFFICE-39)
 * are surfaced by their owning stories.
 */

export const COMPLIANCE_VIEW_SCOPE = 'compliance:reports:read'
const REPORT_GENERATION_DEEPLINK = '/back-office/reports:generate'

export interface ComplianceMetricsReader {
  consentVolumes(): Promise<ConsentVolumes>
  disputeBacklog(): Promise<DisputeBacklog>
  riskSignalBacklog(): Promise<RiskSignalBacklog>
  reportLibrary(): Promise<ReportLibrary>
}
export interface RetentionReader {
  retentionStatus(): Promise<RetentionStatusRow[]>
}

export interface ComplianceViewDeps {
  metrics: ComplianceMetricsReader
  retention: RetentionReader
  region?: string
  now?: () => Date
}

export class ComplianceViewService {
  constructor(private readonly deps: ComplianceViewDeps) {}

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, COMPLIANCE_VIEW_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()

    const [consents, disputes, riskBacklog, reports, retention] = await Promise.all([
      this.deps.metrics.consentVolumes(),
      this.deps.metrics.disputeBacklog(),
      this.deps.metrics.riskSignalBacklog(),
      this.deps.metrics.reportLibrary(),
      this.deps.retention.retentionStatus()
    ])

    const overdueRetention = retention.filter((r) => r.past_immutable_count > 0).map((r) => r.table_name)
    const data = {
      consent_volumes: consents,
      residency_posture: { region: this.deps.region ?? 'UAE', data_residency: 'enforced', basis: 'PDPL + CBUAE data-residency (IaC region parameter)' },
      retention_status: {
        tables: retention.map((r) => ({ table_name: r.table_name, hot_tier_count: r.hot_tier_count, warm_tier_count: r.warm_tier_count, past_immutable_count: r.past_immutable_count })),
        overdue_tables: overdueRetention,
        deletion_allowed: false
      },
      dispute_backlog: disputes,
      risk_signal_backlog: riskBacklog,
      report_library: { by_status: reports.by_status, by_type: reports.by_type },
      inquiry_history: reports.recent_inquiries,
      periodic_report_generation_deeplink: REPORT_GENERATION_DEEPLINK
    }
    // BACKOFFICE-40 — live aggregates computed on read → trivially fresh; the
    // deletion-forbidden retention policy makes an overdue-immutable row a posture
    // flag (in data.retention_status.overdue_tables), not view staleness.
    return { data, freshness: liveFreshness(now) }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function complianceViewRoutes(service: ComplianceViewService): Record<string, Handler> {
  return {
    'get /back-office/analytics/compliance-view': async (c) => {
      try {
        const { data, freshness } = await service.view(c.get('principal'))
        return c.json({ ...dataEnvelope(data), freshness }, 200)
      } catch (e) {
        const denied = scopeDenied(c, e)
        if (denied) return denied
        throw e
      }
    }
  }
}
