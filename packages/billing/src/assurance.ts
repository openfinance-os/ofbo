import { MF_PER_AED } from './money.js'
import type { ClosedPeriodRerating, CollectionMemoDiff } from './memo.js'
import type { MeteringResult } from './metering.js'
import type { BillingFeeClass } from './rate-card.js'
import type { RatingResult } from './rating.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export type RevenueAssuranceFindingCode =
  | 'memo_under_collection'
  | 'rate_drift'
  | 'free_tier_abuse'
  | 'unbilled_traffic'
  | 'metering_blind_spot'
  | 'silent_overage'
  | 'unsuccessful_calls'

export interface FreeTierException {
  exceptionId: string
  tppId: string
  missedBillableUnits: number
  valuationRateMilliFils: number
  sourceRefs: string[]
}

export interface RevenueRecovery {
  recoveryId: string
  period: string
  findingCode: Exclude<RevenueAssuranceFindingCode, 'silent_overage' | 'unsuccessful_calls'>
  amountMilliFils: number
  recoveredAt: string
  sourceRef: string
}

export interface OverageOpportunity {
  publishedRateMilliFils: number | null
  valuationRateMilliFils: number
  valuationRef: string
}

export interface RevenueAssuranceInput {
  period: string
  generatedAt: string
  metering: MeteringResult
  rating: RatingResult
  memoDiffs: CollectionMemoDiff[]
  reratings: ClosedPeriodRerating[]
  registeredTppIds: string[]
  blindSpotValuationMilliFils: number
  freeTierExceptions: FreeTierException[]
  overageOpportunity: OverageOpportunity
  recoveries: RevenueRecovery[]
}

export interface RevenueAssuranceFinding {
  code: RevenueAssuranceFindingCode
  title: string
  amountMilliFils: number
  amountAed: number
  counterfactualMilliFils: number
  counterfactualAed: number
  recoverable: boolean
  status: 'open' | 'query_required' | 'blocked' | 'opportunity' | 'informational'
  owner: 'Finance' | 'Finance Ops' | 'Platform' | 'Commercial'
  sourceRefs: string[]
}

export interface RevenueAssuranceFeeVariance {
  feeClass: BillingFeeClass
  expectedMilliFils: number
  memoMilliFils: number
  varianceMilliFils: number
}

export interface RevenueAssuranceReport {
  period: string
  generatedAt: string
  currency: 'AED'
  meteringCoveragePercent: number
  grossReceivableMilliFils: number
  leakageMilliFils: number
  leakageAed: number
  leakagePercent: number
  counterfactualOpportunityMilliFils: number
  counterfactualOpportunityAed: number
  recoverableMilliFils: number
  recoveredRevenueMilliFils: number
  recoveredRevenueAed: number
  outstandingRecoverableMilliFils: number
  findings: RevenueAssuranceFinding[]
  varianceByFeeClass: RevenueAssuranceFeeVariance[]
  recoveries: RevenueRecovery[]
  disputeWindow: { raised: number; missed: number; targetMissed: 0 }
  target: { thresholdPercent: 1; comparison: 'strictly_below'; met: boolean }
  roiContribution: { feeVarianceRecoveredMilliFils: number; feeVarianceRecoveredAed: number }
}

function safeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer in milli-fils`)
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty`)
  return value
}

function iso(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError(`${label} must be an ISO-8601 timestamp`)
  return new Date(value).toISOString()
}

function aed(milliFils: number): number {
  return Number((milliFils / MF_PER_AED).toFixed(3))
}

function finding(
  code: RevenueAssuranceFindingCode,
  title: string,
  amountMilliFils: number,
  counterfactualMilliFils: number,
  recoverable: boolean,
  status: RevenueAssuranceFinding['status'],
  owner: RevenueAssuranceFinding['owner'],
  sourceRefs: string[]
): RevenueAssuranceFinding {
  safeNonNegative(amountMilliFils, `${code} amount`)
  safeNonNegative(counterfactualMilliFils, `${code} counterfactual`)
  return {
    code, title, amountMilliFils, amountAed: aed(amountMilliFils),
    counterfactualMilliFils, counterfactualAed: aed(counterfactualMilliFils),
    recoverable, status, owner, sourceRefs: [...new Set(sourceRefs)].sort()
  }
}

function varianceByFeeClass(diffs: readonly CollectionMemoDiff[]): RevenueAssuranceFeeVariance[] {
  const byClass = new Map<BillingFeeClass, RevenueAssuranceFeeVariance>()
  for (const diff of diffs) {
    for (const line of diff.lines) {
      const current = byClass.get(line.feeClass) ?? { feeClass: line.feeClass, expectedMilliFils: 0, memoMilliFils: 0, varianceMilliFils: 0 }
      current.expectedMilliFils += line.expectedMilliFils
      current.memoMilliFils += line.memoMilliFils
      current.varianceMilliFils += line.varianceMilliFils
      byClass.set(line.feeClass, current)
    }
  }
  return [...byClass.values()].sort((left, right) => left.feeClass.localeCompare(right.feeClass))
}

/**
 * BILL-08 — compute a deterministic monthly assurance report from independently metered,
 * rated, scheme-memo, directory and recovery evidence. No PSU identifiers enter the report.
 */
export function buildRevenueAssuranceReport(input: RevenueAssuranceInput): RevenueAssuranceReport {
  if (!MONTH.test(input.period)) throw new RangeError('period must be YYYY-MM')
  const generatedAt = iso(input.generatedAt, 'generatedAt')
  if (input.rating.period !== input.period) throw new Error(`rating period ${input.rating.period} does not match assurance period ${input.period}`)
  for (const diff of input.memoDiffs) if (diff.expectedPeriod !== input.period) throw new Error(`memo period ${diff.expectedPeriod} does not match assurance period ${input.period}`)
  for (const replay of input.reratings) if (replay.period !== input.period) throw new Error(`rerating period ${replay.period} does not match assurance period ${input.period}`)
  safeNonNegative(input.blindSpotValuationMilliFils, 'blind-spot valuation')
  safeNonNegative(input.overageOpportunity.valuationRateMilliFils, 'overage valuation rate')
  if (input.overageOpportunity.publishedRateMilliFils !== null) safeNonNegative(input.overageOpportunity.publishedRateMilliFils, 'published overage rate')
  required(input.overageOpportunity.valuationRef, 'overage valuationRef')

  const memoUnderLines = input.memoDiffs.flatMap((diff) => diff.lines
    .filter((line) => line.materialVariance && line.varianceMilliFils < 0)
    .map((line) => ({ ...line, memoReference: diff.memoReference })))
  const memoUnder = memoUnderLines.reduce((sum, line) => sum + Math.abs(line.varianceMilliFils), 0)

  const positiveRateDeltas = input.reratings.flatMap((replay) => replay.lineDeltas
    .filter((line) => line.deltaMilliFils > 0)
    .map((line) => ({ ...line, correctionReference: replay.correctionReference })))
  const rateDrift = positiveRateDeltas.reduce((sum, line) => sum + line.deltaMilliFils, 0)

  const freeTierRefs: string[] = []
  const freeTierAbuse = input.freeTierExceptions.reduce((sum, item) => {
    required(item.exceptionId, 'free-tier exception id')
    required(item.tppId, 'free-tier exception tppId')
    safeNonNegative(item.missedBillableUnits, 'missed billable units')
    safeNonNegative(item.valuationRateMilliFils, 'free-tier valuation rate')
    const amount = item.missedBillableUnits * item.valuationRateMilliFils
    if (!Number.isSafeInteger(amount)) throw new RangeError('free-tier abuse valuation exceeds safe integer range')
    freeTierRefs.push(item.exceptionId, ...item.sourceRefs)
    return sum + amount
  }, 0)

  const registered = new Set(input.registeredTppIds)
  const unbilledLines = input.rating.priced.filter((line) => line.side === 'receivable' && !registered.has(line.tppId) && line.amountMilliFils > 0)
  const unbilled = unbilledLines.reduce((sum, line) => sum + line.amountMilliFils, 0)

  const blindSpots = input.metering.evidence.blindSpots
  const blindSpot = blindSpots.length * input.blindSpotValuationMilliFils
  if (!Number.isSafeInteger(blindSpot)) throw new RangeError('blind-spot valuation exceeds safe integer range')

  const overageUnits = input.rating.priced
    .filter((line) => line.side === 'receivable' && line.feeClass === 'data.retail_page')
    .reduce((sum, line) => sum + line.units, 0)
  const silentOverage = input.overageOpportunity.publishedRateMilliFils === null
    ? overageUnits * input.overageOpportunity.valuationRateMilliFils
    : 0
  if (!Number.isSafeInteger(silentOverage)) throw new RangeError('silent-overage valuation exceeds safe integer range')

  const findings: RevenueAssuranceFinding[] = [
    finding('memo_under_collection', 'Nebras memo under-collection', memoUnder, 0, true, memoUnder > 0 ? 'query_required' : 'informational', 'Finance', memoUnderLines.flatMap((line) => [line.memoReference, line.lineRef, ...line.traceIds])),
    finding('rate_drift', 'Rate-card drift', rateDrift, 0, true, rateDrift > 0 ? 'open' : 'informational', 'Finance', positiveRateDeltas.flatMap((line) => [line.correctionReference, line.lineRef])),
    finding('free_tier_abuse', 'Free-tier abuse', freeTierAbuse, 0, true, freeTierAbuse > 0 ? 'open' : 'informational', 'Finance Ops', freeTierRefs),
    finding('unbilled_traffic', 'Unbilled traffic — no P9 counterparty', unbilled, 0, true, unbilled > 0 ? 'blocked' : 'informational', 'Finance Ops', unbilledLines.flatMap((line) => [line.eventId, line.traceId ?? '']).filter(Boolean)),
    finding('metering_blind_spot', 'Metering blind spot', blindSpot, 0, true, blindSpot > 0 ? 'open' : 'informational', 'Platform', blindSpots.flatMap((spot) => [spot.eventId, spot.endpoint])),
    finding('silent_overage', 'Silent retail-overage give-away', 0, silentOverage, false, silentOverage > 0 ? 'opportunity' : 'informational', 'Commercial', silentOverage > 0 ? [input.overageOpportunity.valuationRef] : []),
    finding('unsuccessful_calls', 'Technically unsuccessful calls excluded', 0, 0, false, 'informational', 'Platform', [`excluded:${input.metering.stats.excludedUnsuccessful}`])
  ]

  const recoverableMilliFils = findings.filter((item) => item.recoverable).reduce((sum, item) => sum + item.amountMilliFils, 0)
  const recoveryIds = new Set<string>()
  for (const recovery of input.recoveries) {
    required(recovery.recoveryId, 'recoveryId')
    if (recoveryIds.has(recovery.recoveryId)) throw new Error(`duplicate recovery ${recovery.recoveryId}`)
    recoveryIds.add(recovery.recoveryId)
    if (recovery.period !== input.period) throw new Error(`recovery period ${recovery.period} does not match assurance period ${input.period}`)
    safeNonNegative(recovery.amountMilliFils, 'recovery amount')
    if (recovery.amountMilliFils === 0) throw new RangeError('recovery amount must be greater than zero')
    iso(recovery.recoveredAt, 'recoveredAt')
    required(recovery.sourceRef, 'recovery sourceRef')
  }
  const recoveredRevenueMilliFils = input.recoveries.reduce((sum, item) => sum + item.amountMilliFils, 0)
  if (recoveredRevenueMilliFils > recoverableMilliFils) throw new Error('recovered revenue exceeds identified recoverable leakage')

  const leakageMilliFils = recoverableMilliFils
  const potentialRevenue = input.rating.receivableTotalMilliFils + leakageMilliFils
  const leakagePercent = potentialRevenue === 0 ? 0 : Number(((leakageMilliFils / potentialRevenue) * 100).toFixed(3))
  const raised = input.memoDiffs.reduce((sum, diff) => sum + diff.materialBreaks, 0)
  const missed = input.memoDiffs.filter((diff) => diff.queryWindowStatus === 'expired').reduce((sum, diff) => sum + diff.materialBreaks, 0)

  return {
    period: input.period, generatedAt, currency: 'AED', meteringCoveragePercent: input.metering.stats.coveragePercent,
    grossReceivableMilliFils: input.rating.receivableTotalMilliFils,
    leakageMilliFils, leakageAed: aed(leakageMilliFils), leakagePercent,
    counterfactualOpportunityMilliFils: silentOverage, counterfactualOpportunityAed: aed(silentOverage),
    recoverableMilliFils, recoveredRevenueMilliFils, recoveredRevenueAed: aed(recoveredRevenueMilliFils),
    outstandingRecoverableMilliFils: recoverableMilliFils - recoveredRevenueMilliFils,
    findings, varianceByFeeClass: varianceByFeeClass(input.memoDiffs), recoveries: structuredClone(input.recoveries),
    disputeWindow: { raised, missed, targetMissed: 0 },
    target: { thresholdPercent: 1, comparison: 'strictly_below', met: leakagePercent < 1 },
    roiContribution: { feeVarianceRecoveredMilliFils: recoveredRevenueMilliFils, feeVarianceRecoveredAed: aed(recoveredRevenueMilliFils) }
  }
}
