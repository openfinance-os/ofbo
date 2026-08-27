import type { Context } from 'hono'
import type { ItsmPort } from '@ofbo/ports'
import type { LiabilityMonitor } from '@ofbo/db'
import type { Principal } from '../auth.js'
import { assertScope } from '../rbac.js'
import { scopeDenied } from '../errors.js'
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
  fraud_prevention_failure: 10000,
  /**
   * International-payment new-beneficiary breach. The scheme caps exposure at AED 15,000 for 48
   * hours after beneficiary creation, per customer per TPP per bank; redress is AED 1,000 plus
   * direct losses, and the AED 1,000 is what this matrix prices — the cap bounds the aggregate,
   * not the per-incident liability the monitor accrues.
   *
   * It was missing entirely, which under the old zero-default meant the class priced at 0 and
   * crossed its threshold on the first incident.
   */
  new_beneficiary_breach: 1000
}

/** The scheme's aggregate cap on a new-beneficiary breach — 48h, per customer per TPP per bank. */
export const NEW_BENEFICIARY_EXPOSURE_CAP_AED = 15000
/** SLA-execution failure is tiered 350/250/200 by delay severity (v2.1). */
export const SLA_TIERS: Record<number, number> = { 1: 350, 2: 250, 3: 200 }

/**
 * A liability class the scheme publishes and this matrix has not priced.
 *
 * Named, rather than a bare Error, because the two callers must answer it differently. A scheduled
 * job (worker.ts) should fail its run — there is no correct exposure figure to record. A
 * synchronous READ must not: `GET /back-office/analytics/nebras-liability-monitor` is documented as
 * a 200, and one unpriced class in telemetry taking down the whole risk view — including the parts
 * that do not depend on it — trades a wrong number for no screen at all. The read reports the gap
 * as a gap instead (see `unpriced_classes` in liability-forecast.ts).
 */
export class UnmodelledLiabilityClassError extends Error {
  constructor(public readonly issue: string, message: string) {
    super(message)
    this.name = 'UnmodelledLiabilityClassError'
  }
}

export interface LiabilityEvent {
  issue: string
  liable_party: LiableParty
  incident_count: number
  sla_tier?: number
}

/**
 * The per-incident liability for an issue class. RAISES on a class the matrix does not model.
 *
 * It used to return 0, and the threshold in `evaluate` derives from THE SAME lookup — so both
 * sides were 0, `accrued >= threshold` was `0 >= 0`, and an unmodelled class crossed on its first
 * incident. The result was not silence, which would at least have been investigated: it emitted a
 * `nebras_liability_approach` signal and two P3 ITSM tickets reporting the bank's exposure as
 * `AED 0` at `low` severity. A queue full of confident zeroes looks like a monitor that is working.
 *
 * A class the scheme has published and this matrix has not priced is a gap in OUR model, and the
 * only safe answer is to say so loudly. Callers are scheduled jobs (worker.ts) and the monitor,
 * both of which surface a throw; none of them can do anything useful with a fabricated zero.
 */
export function liabilityAmount(event: { issue: string; sla_tier?: number }): number {
  if (event.issue === 'sla_execution_failure') {
    // An UNMODELLED TIER is the same defect as an unmodelled class, one line apart. This used to
    // read `SLA_TIERS[event.sla_tier ?? 1] ?? SLA_TIERS[1]!`, so an `sla_tier` of 4 — or 0, or
    // anything the scheme adds — was silently priced at tier 1's AED 350 and went on to accrue,
    // signal and ticket under a number nobody chose. The tier defaults to 1 when ABSENT, which is
    // the documented v2.1 default and a real answer; a tier that is present and unknown is not.
    const tier = event.sla_tier ?? 1
    const tiered = SLA_TIERS[tier]
    if (tiered === undefined) {
      throw new UnmodelledLiabilityClassError(
        `sla_execution_failure:tier-${tier}`,
        `unmodelled Nebras SLA-execution tier ${tier} — SLA_TIERS prices tiers `
        + `${Object.keys(SLA_TIERS).join(', ')} only, so this delay severity cannot be priced. `
        + 'Add the tier with its scheme citation rather than pricing it as tier 1.'
      )
    }
    return tiered
  }
  const amount = LIABILITY_MATRIX[event.issue]
  if (amount === undefined) {
    throw new UnmodelledLiabilityClassError(
      event.issue,
      `unmodelled Nebras liability class '${event.issue}' — it has no entry in LIABILITY_MATRIX, `
      + 'so its exposure cannot be priced. Add the class with its scheme citation rather than '
      + 'letting it accrue as zero.'
    )
  }
  return amount
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
    // PRICE THE WHOLE BATCH FIRST, before anything is emitted.
    //
    // The throw used to fire from inside the loop below, which meant an unmodelled class at
    // position 2 left position 1's risk signal and two P3 ITSM tickets already written — and
    // worker.ts retries the whole batch on its next run, so the survivors are re-evaluated against
    // a dedup set that now contains them. Half a batch is the worst of both answers: it neither
    // completes nor leaves the queue clean. Pricing up front makes the batch all-or-nothing.
    for (const e of events) liabilityAmount(e)

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
    // UIF-04 (ADR 0016 D1) — typed sections the portal renders as bespoke panels; live data.
    const severitySegments = Object.entries(monitor.by_severity)
      .map(([label, value]) => ({ label, value }))
      .filter((seg) => seg.value > 0)
    const sections: Record<string, unknown>[] = []
    if (severitySegments.length > 0) sections.push({ kind: 'contribution-bars', title: 'Liability Events by Severity', segments: severitySegments })
    if (accrual.length > 0) {
      sections.push({
        kind: 'object-table',
        title: 'Approaching Liability Triggers',
        table: {
          columns: ['issue', 'liable_party', 'accrued_aed', 'severity'],
          rows: accrual.map((a) => ({ issue: a.issue, liable_party: a.liable_party, accrued_aed: a.accrued_aed, severity: a.severity }))
        }
      })
    }

    const data: Record<string, unknown> = {
      liability_matrix: {
        per_incident_aed: LIABILITY_MATRIX,
        sla_execution_tiers_aed: SLA_TIERS,
        // The aggregate cap that QUALIFIES new_beneficiary_breach. This block is the authoritative
        // statement of scheme amounts for a `risk:read` consumer, and publishing the AED 1,000
        // per-incident redress without it invites the reading that exposure is unbounded — the cap
        // is a different KIND of number (48h aggregate, per customer per TPP per bank), not a
        // per-incident price, which is why it sits beside the matrix rather than inside it.
        new_beneficiary_exposure_cap_aed: NEW_BENEFICIARY_EXPOSURE_CAP_AED
      },
      open_count: monitor.open_count,
      by_severity: monitor.by_severity,
      approaching_triggers: accrual,
      sections
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
        const denied = scopeDenied(c, e)
        if (denied) return denied
        throw e
      }
    }
  }
}
