import type { Context } from 'hono'
import type { ConsentVolumes, StoredCertification } from '@ofbo/db'
import type { OnboardingHandoverPort } from '@ofbo/ports'
import type { MarginSummary } from '../reconciliation/margin.js'
import type { ProgrammeAngleBuilder } from './programme.js'
import { liveFreshness, type FreshnessEnvelope } from './freshness.js'
import type { Principal } from '../auth.js'
import { assertScope, hasScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope } from '../envelope.js'

/**
 * BACKOFFICE-27 — single consolidated Executive Dashboard with persona-aware angles.
 * One canonical dashboard (base scope platform:analytics:read, enforced at the BFF
 * middleware AND re-checked here); the two pivot angles are SCOPE-GATED so the matrix
 * holds: Commercial (revenue/margin/pipeline) needs commercial:read, Programme
 * (adoption/certification/release-calendar) needs programme:read. A shared headline
 * (consent volumes, onboarding funnel, reconciliation throughput) is visible to every
 * platform:analytics:read holder. Aggregate figures only, no PSU PII. With the
 * freshness envelope (BACKOFFICE-40).
 */

export const EXEC_DASHBOARD_SCOPE = 'platform:analytics:read'
const COMMERCIAL_SCOPE = 'commercial:read'
const PROGRAMME_SCOPE = 'programme:read'

export interface ExecConsentReader {
  consentVolumes(): Promise<ConsentVolumes>
}
export interface ExecMarginReader {
  marginForPeriod(period: string): Promise<MarginSummary>
}
export interface ExecPipelineReader {
  pipelineCounts(): Promise<Record<string, number>>
}
export interface ExecCertificationReader {
  list(): Promise<StoredCertification[]>
}
export interface ExecReconReader {
  latestRun(): Promise<{ line_count_total: number; line_count_matched: number } | null>
}

export interface ExecutiveDashboardDeps {
  consents: ExecConsentReader
  margin: ExecMarginReader
  pipeline: ExecPipelineReader
  certifications: ExecCertificationReader
  recon: ExecReconReader
  handover: Pick<OnboardingHandoverPort, 'getFunnelEvents'>
  /** BACKOFFICE-39 — builds the Programme angle (certification, onboarding readiness,
   *  release-calendar alignment, multi-entity visibility). */
  programme: ProgrammeAngleBuilder
  now?: () => Date
}

function revenueByFamily(margin: MarginSummary) {
  const byFamily: Record<string, { nebras_fee: number; fintech_charge: number; margin: number }> = {}
  for (const fm of Object.values(margin.by_fintech)) {
    for (const [family, acc] of Object.entries(fm.by_family)) {
      const b = (byFamily[family] ??= { nebras_fee: 0, fintech_charge: 0, margin: 0 })
      b.nebras_fee += acc.nebras_fee
      b.fintech_charge += acc.fintech_charge
      b.margin += acc.margin
    }
  }
  return byFamily
}

function summarizeHandover(events: { entry_path: string; stage: string; at: string }[]) {
  const byEntryPath: Record<string, number> = {}
  for (const e of events) byEntryPath[e.entry_path] = (byEntryPath[e.entry_path] ?? 0) + 1
  return { by_entry_path: byEntryPath, total_events: events.length }
}

export class ExecutiveDashboardService {
  constructor(private readonly deps: ExecutiveDashboardDeps) {}

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, EXEC_DASHBOARD_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()
    const period = now.toISOString().slice(0, 7)
    const windowEnd = now.toISOString()
    const windowStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()

    const [consents, handoverEvents, latestRun] = await Promise.all([
      this.deps.consents.consentVolumes(),
      this.deps.handover.getFunnelEvents({ from: windowStart, to: windowEnd }),
      this.deps.recon.latestRun()
    ])

    const reconThroughput = latestRun
      ? { line_count_total: latestRun.line_count_total, line_count_matched: latestRun.line_count_matched, success_rate: latestRun.line_count_total > 0 ? Math.round((latestRun.line_count_matched / latestRun.line_count_total) * 1000) / 1000 : null }
      : null

    const data: Record<string, unknown> = {
      period,
      available_angles: [] as string[],
      headline: {
        consent_volumes: consents,
        onboarding_funnel: summarizeHandover(handoverEvents),
        reconciliation_throughput: reconThroughput
      }
    }
    const available: string[] = []

    // UIF-03 (ADR 0016 D1) — typed analytics sections the portal renders as bespoke panels.
    // Bound to the live-computed metrics above (no mock values); scope-gated like the angles.
    const sections: Record<string, unknown>[] = []
    if (reconThroughput && reconThroughput.success_rate != null) {
      sections.push({
        kind: 'gauge',
        title: 'Reconciliation Pass Rate',
        gauge: { value: Math.round(reconThroughput.success_rate * 1000) / 10, max: 100, unit: '%' }
      })
    }

    if (hasScope(principal.scopes, COMMERCIAL_SCOPE)) {
      const margin = await this.deps.margin.marginForPeriod(period)
      const pipeline = await this.deps.pipeline.pipelineCounts()
      data.commercial = {
        revenue_by_product_family: revenueByFamily(margin),
        tpp_aas_margin: { total_margin: margin.total_margin, total_nebras_fee: margin.total_nebras_fee, total_fintech_charge: margin.total_fintech_charge, currency: margin.currency },
        integration_pipeline: { by_state: pipeline, total: Object.values(pipeline).reduce((a, b) => a + b, 0) }
      }
      available.push('commercial')

      // Commercial-angle bespoke sections (integer minor units → formatted money).
      const fmt = (minor: number) => `${margin.currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      sections.push({
        kind: 'kpi-strip',
        title: 'Commercial Metrics',
        stats: [
          { label: 'TPP-AAS net margin', value: fmt(margin.total_margin) },
          { label: 'Nebras fees', value: fmt(margin.total_nebras_fee) },
          { label: 'Fintech charges', value: fmt(margin.total_fintech_charge) },
          { label: 'Integration pipeline', value: String(Object.values(pipeline).reduce((a, b) => a + b, 0)), sublabel: 'active' }
        ]
      })
      const familySegments = Object.entries(revenueByFamily(margin))
        .map(([family, m]) => ({ label: family, value: Math.max(0, m.margin) }))
        .filter((seg) => seg.value > 0)
      if (familySegments.length > 0) {
        sections.push({ kind: 'contribution-bars', title: 'Margin by Product Family', segments: familySegments })
      }
    }

    if (hasScope(principal.scopes, PROGRAMME_SCOPE)) {
      // BACKOFFICE-39 — the Programme angle (certification, TPP onboarding readiness,
      // CBUAE release-calendar alignment, multi-entity group visibility) is built by
      // the Programme reporting service.
      const [certs, pipeline] = await Promise.all([this.deps.certifications.list(), this.deps.pipeline.pipelineCounts()])
      data.programme = this.deps.programme.build(certs, pipeline, now)
      available.push('programme')
    }

    data.available_angles = available
    data.sections = sections
    // BACKOFFICE-40 — live-computed dashboard (no external source) → always fresh.
    return { data, freshness: liveFreshness(now) }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function executiveDashboardRoutes(service: ExecutiveDashboardService): Record<string, Handler> {
  return {
    'get /back-office/analytics/executive-dashboard': async (c) => {
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
