import {
  buildRevenueAssuranceReport,
  rateUsage,
  type CollectionMemoDiff,
  type ClosedPeriodRerating,
  type FreeTierException,
  type MeteringResult,
  type OverageOpportunity,
  type RateCard,
  type RevenueAssuranceInput,
  type RevenueAssuranceReport,
  type RevenueRecovery
} from '@ofbo/billing'
import type { HighClassAuditSink } from '../high-class-audit.js'

export const BILLING_ASSURANCE_SCOPE = 'billing:assure'

export interface RevenueAssuranceStore {
  appendRecovery(recovery: RevenueRecovery, traceId: string): Promise<{ id: string; created: boolean }>
  recoveriesForPeriod(period: string): Promise<RevenueRecovery[]>
  saveReport(report: RevenueAssuranceReport, traceId: string): Promise<{ id: string; created: boolean }>
  latestReport(period: string): Promise<RevenueAssuranceReport | null>
}

export interface RevenueAssuranceEvidenceSource {
  evidenceForPeriod(period: string): Promise<{
    metering: MeteringResult
    memoDiffs: CollectionMemoDiff[]
    reratings: ClosedPeriodRerating[]
    registeredTppIds: string[]
  } | null>
}

export class InMemoryRevenueAssuranceStore implements RevenueAssuranceStore {
  readonly recoveries: RevenueRecovery[] = []
  readonly reports: Array<{ id: string; report: RevenueAssuranceReport }> = []

  async appendRecovery(recovery: RevenueRecovery): Promise<{ id: string; created: boolean }> {
    const existing = this.recoveries.find((item) => item.recoveryId === recovery.recoveryId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(recovery)) throw new Error(`conflicting immutable recovery ${recovery.recoveryId}`)
      return { id: recovery.recoveryId, created: false }
    }
    this.recoveries.push(structuredClone(recovery))
    return { id: recovery.recoveryId, created: true }
  }

  async recoveriesForPeriod(period: string): Promise<RevenueRecovery[]> {
    return structuredClone(this.recoveries.filter((item) => item.period === period))
  }

  async saveReport(report: RevenueAssuranceReport): Promise<{ id: string; created: boolean }> {
    const existing = this.reports.find((item) => JSON.stringify(item.report) === JSON.stringify(report))
    if (existing) return { id: existing.id, created: false }
    const id = `revenue-assurance-${this.reports.length + 1}`
    this.reports.push({ id, report: structuredClone(report) })
    return { id, created: true }
  }

  async latestReport(period: string): Promise<RevenueAssuranceReport | null> {
    return structuredClone([...this.reports].reverse().find((item) => item.report.period === period)?.report ?? null)
  }
}

/** BILL-08 — headless monthly report and append-only recovered-revenue workflow. */
export class RevenueAssuranceService {
  constructor(private readonly deps: { store: RevenueAssuranceStore; audit: HighClassAuditSink; evidence?: RevenueAssuranceEvidenceSource }) {}

  async recordRecovery(recovery: RevenueRecovery, traceId: string): Promise<{ id: string; created: boolean }> {
    if (!recovery.recoveryId.trim() || !recovery.sourceRef.trim()) throw new TypeError('recovery id and source reference are required')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(recovery.period)) throw new RangeError('recovery period must be YYYY-MM')
    if (!Number.isSafeInteger(recovery.amountMilliFils) || recovery.amountMilliFils <= 0) throw new RangeError('recovery amount must be a positive safe integer')
    if (!Number.isFinite(Date.parse(recovery.recoveredAt))) throw new RangeError('recoveredAt must be an ISO-8601 timestamp')
    const saved = await this.deps.store.appendRecovery(recovery, traceId)
    if (saved.created) {
      await this.deps.audit.emit({
        event_type: 'billing_revenue_recovered', acting_principal: 'system:revenue-assurance', acting_persona: 'system',
        scope_used: BILLING_ASSURANCE_SCOPE, request_trace_id: traceId,
        request_body: { recovery_id: recovery.recoveryId, period: recovery.period, finding_code: recovery.findingCode, amount_milli_fils: recovery.amountMilliFils, source_ref: recovery.sourceRef },
        response_status: 201
      })
    }
    return saved
  }

  async generate(input: Omit<RevenueAssuranceInput, 'recoveries'>, traceId: string): Promise<{ id: string; created: boolean; report: RevenueAssuranceReport }> {
    const recoveries = await this.deps.store.recoveriesForPeriod(input.period)
    const report = buildRevenueAssuranceReport({ ...input, recoveries })
    const saved = await this.deps.store.saveReport(report, traceId)
    if (saved.created) {
      await this.deps.audit.emit({
        event_type: 'billing_revenue_assurance_report_generated', acting_principal: 'system:revenue-assurance', acting_persona: 'system',
        scope_used: BILLING_ASSURANCE_SCOPE, request_trace_id: traceId,
        request_body: {
          report_id: saved.id, period: report.period, metering_coverage_percent: report.meteringCoveragePercent,
          leakage_milli_fils: report.leakageMilliFils, leakage_percent: report.leakagePercent,
          recovered_revenue_milli_fils: report.recoveredRevenueMilliFils, missed_dispute_windows: report.disputeWindow.missed,
          target_met: report.target.met
        },
        response_status: 201
      })
    }
    return { ...saved, report }
  }

  /** Production monthly entry point: resolve persisted facts, rate them, then use the same pure report engine. */
  async generatePeriod(input: {
    period: string
    generatedAt: string
    rateCard: RateCard
    blindSpotValuationMilliFils: number
    freeTierExceptions: FreeTierException[]
    overageOpportunity: OverageOpportunity
  }, traceId: string): Promise<{ id: string; created: boolean; report: RevenueAssuranceReport }> {
    if (!this.deps.evidence) throw new Error('revenue assurance evidence source is not configured')
    const evidence = await this.deps.evidence.evidenceForPeriod(input.period)
    if (!evidence) throw new Error(`no metering run exists for ${input.period}`)
    return this.generate({
      period: input.period, generatedAt: input.generatedAt, metering: evidence.metering,
      rating: rateUsage(evidence.metering.lines, input.rateCard, input.period),
      memoDiffs: evidence.memoDiffs, reratings: evidence.reratings, registeredTppIds: evidence.registeredTppIds,
      blindSpotValuationMilliFils: input.blindSpotValuationMilliFils,
      freeTierExceptions: input.freeTierExceptions, overageOpportunity: input.overageOpportunity
    }, traceId)
  }

  async latestReport(period: string): Promise<RevenueAssuranceReport | null> {
    return this.deps.store.latestReport(period)
  }
}
