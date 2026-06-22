import type { Context } from 'hono'
import type { StoredCertification, StoredOutage } from '@ofbo/db'
import type { OnboardingHandoverPort } from '@ofbo/ports'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
import { dataEnvelope } from '../envelope.js'
import { computeFreshness, FRESHNESS_CADENCE, type FreshnessEnvelope } from './freshness.js'
import { computeSlo, summarizeSlos, DemoSloReader, type SloReader } from './slo.js'
import { classifyChain, DemoCertChainSource, type CertChainSource } from '../ops/cert-expiry.js'
import { DemoOzoneHealthSource, type OzoneHealthSource } from '../ops/ozone-health.js'

/**
 * BACKOFFICE-28 — Operations Console (platform health). A read-only analytics view
 * (platform:operations:read, enforced at the BFF middleware AND re-checked here) that
 * composes: Nebras connectivity + SLA targets (from the latest BACKOFFICE-32 ingestion
 * snapshot), certification status PER ROLE (LFI/TPP scheme tracks), the TPP onboarding
 * pipeline (BACKOFFICE-71/-72 registration states), onboarding-handover health (P8),
 * and active outages — with the mandatory freshness envelope (BACKOFFICE-40). No
 * mutation, no PSU PII. SLO budget-burn (-58), Ozone health-check (-70) and cert-expiry
 * (-66) enrich this console in later stories.
 */

export const OPS_CONSOLE_SCOPE = 'platform:operations:read'

// Scheme SLA: 500ms end-to-end; the LFI internal allocation is bank-configurable
// (default 250ms) — PRD §7 BACKOFFICE-28 / adopting-bank defaults.
const SLA_TARGETS = { end_to_end_ms: 500, lfi_internal_ms: 250 }

export interface OpsCertificationReader {
  list(): Promise<StoredCertification[]>
}
export interface OpsOutageReader {
  listActive(): Promise<StoredOutage[]>
}
export interface OpsConnectivityReader {
  latest(): Promise<{ ingested_at: string; published_at: string; freshness: string } | null>
}
export interface OpsPipelineReader {
  pipelineCounts(): Promise<Record<string, number>>
}

export interface OperationsConsoleDeps {
  certifications: OpsCertificationReader
  outages: OpsOutageReader
  connectivity: OpsConnectivityReader
  pipeline: OpsPipelineReader
  handover: Pick<OnboardingHandoverPort, 'getFunnelEvents'>
  /** BACKOFFICE-58 — SLO observations (omit → deterministic demo reader). */
  slo?: SloReader
  /** BACKOFFICE-66 — scheme certificate chain (omit → deterministic demo source). */
  certChain?: CertChainSource
  /** BACKOFFICE-70 — LFI Ozone Connect health (omit → deterministic demo source). */
  ozone?: OzoneHealthSource
  now?: () => Date
}

function summarizeHandover(events: { entry_path: string; stage: string; at: string }[]) {
  const byEntryPath: Record<string, number> = {}
  let latest: string | null = null
  for (const e of events) {
    byEntryPath[e.entry_path] = (byEntryPath[e.entry_path] ?? 0) + 1
    if (!latest || e.at > latest) latest = e.at
  }
  return { by_entry_path: byEntryPath, total_events: events.length, latest_event_at: latest }
}

export class OperationsConsoleService {
  constructor(private readonly deps: OperationsConsoleDeps) {}

  async view(principal: Principal): Promise<{ data: Record<string, unknown>; freshness: FreshnessEnvelope }> {
    assertScope(principal, OPS_CONSOLE_SCOPE)
    const now = (this.deps.now ?? (() => new Date()))()
    const windowEnd = now.toISOString()
    const windowStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()

    const [certs, activeOutages, latestSnapshot, pipeline, handoverEvents, sloObs] = await Promise.all([
      this.deps.certifications.list(),
      this.deps.outages.listActive(),
      this.deps.connectivity.latest(),
      this.deps.pipeline.pipelineCounts(),
      this.deps.handover.getFunnelEvents({ from: windowStart, to: windowEnd }),
      (this.deps.slo ?? new DemoSloReader()).getSloObservations()
    ])
    // BACKOFFICE-58 — SLO observability: target, error budget remaining + burn rate
    // per SLO, surfaced in the console (no separate APM login).
    const slos = sloObs.map(computeSlo)
    // BACKOFFICE-66 — scheme certificate expiry: the chain classified amber/red/critical
    // (the scheduled monitor raises the tickets/audit; this is the read surface).
    const scheme_certificates = await classifyChain(this.deps.certChain ?? new DemoCertChainSource(() => now), now)
    // BACKOFFICE-70 — LFI Ozone Connect health on the platform-health screen.
    const ozone_connect = await (this.deps.ozone ?? new DemoOzoneHealthSource(() => now)).getHealth()

    const connectivityStatus = latestSnapshot === null ? 'unknown' : latestSnapshot.freshness === 'fresh' ? 'connected' : 'degraded'
    const byRole = (role: string) =>
      certs
        .filter((c) => c.role === role)
        .map((c) => ({ subject: c.subject, track: c.track, current_stage: c.current_stage, stages_completed: c.stages_completed, stages_total: c.stages_total, status: c.status }))

    // UIF-05 (ADR 0016 D1) — typed sections the portal renders as bespoke panels; live data.
    const pipelineTotal = Object.values(pipeline).reduce((n, v) => n + v, 0)
    const pipelineSegments = Object.entries(pipeline).map(([label, value]) => ({ label, value })).filter((seg) => seg.value > 0)
    const sections: Record<string, unknown>[] = [
      {
        kind: 'kpi-strip',
        title: 'Platform Health',
        stats: [
          { label: 'Active outages', value: String(activeOutages.length) },
          { label: 'TPP onboarding', value: String(pipelineTotal), sublabel: 'in pipeline' },
          { label: 'Nebras connectivity', value: connectivityStatus }
        ]
      }
    ]
    if (pipelineSegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'TPP Onboarding Pipeline', segments: pipelineSegments })
    if (activeOutages.length > 0) {
      sections.push({
        kind: 'object-table',
        title: 'Active Outages',
        table: {
          columns: ['title', 'component', 'severity', 'started_at'],
          rows: activeOutages.map((o) => ({ title: o.title, component: o.component, severity: o.severity, started_at: o.started_at }))
        }
      })
    }

    const data = {
      sections,
      nebras_connectivity: {
        status: connectivityStatus,
        last_contact_at: latestSnapshot?.ingested_at ?? null,
        last_poll_freshness: latestSnapshot?.freshness ?? null,
        sla_targets: SLA_TARGETS
      },
      certification: { lfi: byRole('LFI'), tpp: byRole('TPP') },
      tpp_onboarding_pipeline: { by_state: pipeline, total: Object.values(pipeline).reduce((n, v) => n + v, 0) },
      onboarding_handover_health: summarizeHandover(handoverEvents),
      active_outages: activeOutages.map((o) => ({ title: o.title, component: o.component, severity: o.severity, started_at: o.started_at })),
      active_outage_count: activeOutages.length,
      slo: { window_days: slos[0]?.window_days ?? 30, summary: summarizeSlos(slos), slos },
      scheme_certificates,
      ozone_connect
    }
    // BACKOFFICE-40 — standard freshness: connectivity status is the domain signal
    // (degraded/unknown → amber), else amber when the last poll is older than 2× the
    // daily ingestion cadence.
    // Connectivity freshness tracks the LAST SUCCESSFUL POLL (ingested_at), not the
    // data's monthly roll-up date — the scheduled ingestion runs daily, so a poll
    // older than 2× daily means ingestion silently stopped.
    const freshness = computeFreshness({
      sourcePublishedAt: latestSnapshot?.ingested_at ?? null,
      now,
      sourceCadenceMs: FRESHNESS_CADENCE.DAILY_MS,
      missingCause: 'no_nebras_ingestion_yet',
      extraStale: connectivityStatus === 'degraded' ? { stale: true, cause: 'last_nebras_poll_stale' } : null
    })
    return { data, freshness }
  }
}

type Handler = (c: Context, params: Record<string, string>) => Promise<Response>

export function operationsConsoleRoutes(service: OperationsConsoleService): Record<string, Handler> {
  return {
    'get /back-office/analytics/operations-console': async (c) => {
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
