import { fils } from './money.js'
import { rateUsage, type MeteredLine, type RatingResult } from './rating.js'
import type { BillingFeeClass, RateCard } from './rate-card.js'

export const COLLECTION_MEMO_QUERY_WINDOW_DAYS = 30
export const DEFAULT_MEMO_VARIANCE_THRESHOLD_MILLI_FILS = fils(1)

export interface ExpectedCollectionMemoLine {
  lineRef: string
  tppId: string
  feeClass: BillingFeeClass
  units: number
  events: number
  amountMilliFils: number
  valueMilliFils: number
  eventIds: string[]
  traceIds: string[]
}

export interface ExpectedCollectionMemo {
  period: string
  rateCardVersion: string
  generatedAt: string
  dueAt: string
  generatedOnTime: boolean
  lines: ExpectedCollectionMemoLine[]
  totalMilliFils: number
}

export interface CollectionMemoLine {
  tppId: string
  feeClass: BillingFeeClass
  units: number
  amountMilliFils: number
}

export interface CollectionMemo {
  reference: string
  period: string
  issuedAt: string
  receivedAt: string
  lines: CollectionMemoLine[]
}

export type MemoLinePresence = 'both' | 'expected_only' | 'memo_only'
export type MemoLineStatus = 'matched' | 'break'

export interface CollectionMemoDiffLine {
  lineRef: string
  tppId: string
  feeClass: BillingFeeClass
  expectedUnits: number
  memoUnits: number
  expectedMilliFils: number
  memoMilliFils: number
  varianceMilliFils: number
  materialVariance: boolean
  status: MemoLineStatus
  presence: MemoLinePresence
  eventIds: string[]
  traceIds: string[]
}

export interface CollectionMemoDiff {
  expectedPeriod: string
  expectedRateCardVersion: string
  memoReference: string
  memoIssuedAt: string
  memoReceivedAt: string
  thresholdMilliFils: number
  queryDeadline: string
  queryWindowStatus: 'open' | 'expired'
  daysRemainingAtIngest: number
  lines: CollectionMemoDiffLine[]
  matchedLines: number
  materialBreaks: number
  expectedTotalMilliFils: number
  memoTotalMilliFils: number
  netVarianceMilliFils: number
  grossVarianceMilliFils: number
}

export interface ReratingLineDelta {
  lineRef: string
  tppId: string
  feeClass: BillingFeeClass
  previousMilliFils: number
  correctedMilliFils: number
  deltaMilliFils: number
}

export interface ClosedPeriodRerating {
  period: string
  correctionReference: string
  reratedAt: string
  previousRateCardVersion: string
  correctedRateCardVersion: string
  meteredFactsFingerprint: string
  factsUnchanged: boolean
  previousTotalMilliFils: number
  correctedTotalMilliFils: number
  totalDeltaMilliFils: number
  lineDeltas: ReratingLineDelta[]
  previous: ExpectedCollectionMemo
  corrected: ExpectedCollectionMemo
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000

function assertIsoTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${label} must be an ISO-8601 timestamp`)
  return parsed.toISOString()
}

function assertPeriod(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new RangeError('period must be YYYY-MM')
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
}

function expectationDueAt(period: string): string {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  return new Date(Date.UTC(year, month, 3, 23, 59, 59, 999)).toISOString()
}

export function collectionMemoLineRef(period: string, tppId: string, feeClass: BillingFeeClass): string {
  return `${period}|${tppId}|${feeClass}`
}

/** Convert immutable priced facts into the institution's own receivable expectation. */
export function buildExpectedCollectionMemo(rating: RatingResult, generatedAt: string): ExpectedCollectionMemo {
  assertPeriod(rating.period)
  const generated = assertIsoTimestamp(generatedAt, 'generatedAt')
  const dueAt = expectationDueAt(rating.period)
  const grouped = new Map<string, ExpectedCollectionMemoLine>()

  for (const priced of rating.priced) {
    if (priced.side !== 'receivable') continue
    const lineRef = collectionMemoLineRef(rating.period, priced.tppId, priced.feeClass)
    const current = grouped.get(lineRef) ?? {
      lineRef,
      tppId: priced.tppId,
      feeClass: priced.feeClass,
      units: 0,
      events: 0,
      amountMilliFils: 0,
      valueMilliFils: 0,
      eventIds: [],
      traceIds: []
    }
    current.units += priced.units
    current.events += 1
    current.amountMilliFils += priced.amountMilliFils
    current.valueMilliFils += priced.valueMilliFils ?? 0
    current.eventIds.push(priced.eventId)
    if (priced.traceId) current.traceIds.push(priced.traceId)
    grouped.set(lineRef, current)
  }

  const lines = [...grouped.values()]
    .map((line) => ({
      ...line,
      eventIds: [...new Set(line.eventIds)].sort(),
      traceIds: [...new Set(line.traceIds)].sort()
    }))
    .sort((left, right) => left.lineRef.localeCompare(right.lineRef))

  return {
    period: rating.period,
    rateCardVersion: rating.rateCardVersion,
    generatedAt: generated,
    dueAt,
    generatedOnTime: generated <= dueAt,
    lines,
    totalMilliFils: lines.reduce((sum, line) => sum + line.amountMilliFils, 0)
  }
}

function validateMemo(memo: CollectionMemo): CollectionMemo {
  assertPeriod(memo.period)
  if (!memo.reference.trim()) throw new TypeError('memo reference must be non-empty')
  const issuedAt = assertIsoTimestamp(memo.issuedAt, 'memo.issuedAt')
  const receivedAt = assertIsoTimestamp(memo.receivedAt, 'memo.receivedAt')
  if (receivedAt < issuedAt) throw new RangeError('memo.receivedAt cannot precede memo.issuedAt')
  const seen = new Set<string>()
  const lines = memo.lines.map((line) => {
    if (!line.tppId.trim()) throw new TypeError('memo line tppId must be non-empty')
    assertNonNegativeSafeInteger(line.units, 'memo line units')
    assertNonNegativeSafeInteger(line.amountMilliFils, 'memo line amountMilliFils')
    const key = collectionMemoLineRef(memo.period, line.tppId, line.feeClass)
    if (seen.has(key)) throw new Error(`duplicate Collection Memo line ${key}`)
    seen.add(key)
    return { ...line }
  })
  return { ...memo, issuedAt, receivedAt, lines }
}

/** Compare the scheme memo against the expectation without allowing opposing errors to net away. */
export function diffCollectionMemo(
  expected: ExpectedCollectionMemo,
  inputMemo: CollectionMemo,
  thresholdMilliFils = DEFAULT_MEMO_VARIANCE_THRESHOLD_MILLI_FILS
): CollectionMemoDiff {
  assertNonNegativeSafeInteger(thresholdMilliFils, 'thresholdMilliFils')
  const memo = validateMemo(inputMemo)
  if (memo.period !== expected.period) throw new Error(`memo period ${memo.period} does not match expectation ${expected.period}`)

  const expectedByRef = new Map(expected.lines.map((line) => [line.lineRef, line]))
  const memoByRef = new Map(memo.lines.map((line) => [collectionMemoLineRef(memo.period, line.tppId, line.feeClass), line]))
  const refs = [...new Set([...expectedByRef.keys(), ...memoByRef.keys()])].sort()
  const lines: CollectionMemoDiffLine[] = refs.map((lineRef) => {
    const own = expectedByRef.get(lineRef)
    const scheme = memoByRef.get(lineRef)
    const expectedMilliFils = own?.amountMilliFils ?? 0
    const memoMilliFils = scheme?.amountMilliFils ?? 0
    const varianceMilliFils = memoMilliFils - expectedMilliFils
    const materialVariance = Math.abs(varianceMilliFils) > thresholdMilliFils
    return {
      lineRef,
      tppId: own?.tppId ?? scheme!.tppId,
      feeClass: own?.feeClass ?? scheme!.feeClass,
      expectedUnits: own?.units ?? 0,
      memoUnits: scheme?.units ?? 0,
      expectedMilliFils,
      memoMilliFils,
      varianceMilliFils,
      materialVariance,
      status: materialVariance ? 'break' : 'matched',
      presence: own && scheme ? 'both' : own ? 'expected_only' : 'memo_only',
      eventIds: own?.eventIds ?? [],
      traceIds: own?.traceIds ?? []
    }
  })

  const deadline = new Date(Date.parse(memo.issuedAt) + COLLECTION_MEMO_QUERY_WINDOW_DAYS * DAY_MILLISECONDS)
  const remaining = Math.ceil((deadline.getTime() - Date.parse(memo.receivedAt)) / DAY_MILLISECONDS)
  return {
    expectedPeriod: expected.period,
    expectedRateCardVersion: expected.rateCardVersion,
    memoReference: memo.reference,
    memoIssuedAt: memo.issuedAt,
    memoReceivedAt: memo.receivedAt,
    thresholdMilliFils,
    queryDeadline: deadline.toISOString(),
    queryWindowStatus: remaining >= 0 ? 'open' : 'expired',
    daysRemainingAtIngest: remaining,
    lines,
    matchedLines: lines.filter((line) => line.status === 'matched').length,
    materialBreaks: lines.filter((line) => line.status === 'break').length,
    expectedTotalMilliFils: lines.reduce((sum, line) => sum + line.expectedMilliFils, 0),
    memoTotalMilliFils: lines.reduce((sum, line) => sum + line.memoMilliFils, 0),
    netVarianceMilliFils: lines.reduce((sum, line) => sum + line.varianceMilliFils, 0),
    grossVarianceMilliFils: lines.reduce((sum, line) => sum + Math.abs(line.varianceMilliFils), 0)
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function factFingerprint(lines: readonly MeteredLine[]): string {
  const stable = [...lines]
    .map((line) => canonical(line))
    .sort()
    .join('\n')
  let hash = 0x811c9dc5
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

/** Replay one immutable meter set under two cards and document only the monetary delta. */
export function rerateClosedPeriod(
  meteredLines: readonly MeteredLine[],
  previousCard: RateCard,
  correctedCard: RateCard,
  period: string,
  correctionReference: string,
  reratedAt: string
): ClosedPeriodRerating {
  if (!correctionReference.trim()) throw new TypeError('correctionReference must be non-empty')
  const beforeFingerprint = factFingerprint(meteredLines)
  const previous = buildExpectedCollectionMemo(rateUsage(meteredLines, previousCard, period), reratedAt)
  const corrected = buildExpectedCollectionMemo(rateUsage(meteredLines, correctedCard, period), reratedAt)
  const afterFingerprint = factFingerprint(meteredLines)
  const previousByRef = new Map(previous.lines.map((line) => [line.lineRef, line]))
  const correctedByRef = new Map(corrected.lines.map((line) => [line.lineRef, line]))
  const refs = [...new Set([...previousByRef.keys(), ...correctedByRef.keys()])].sort()
  const lineDeltas = refs.map((lineRef) => {
    const before = previousByRef.get(lineRef)
    const after = correctedByRef.get(lineRef)
    const previousMilliFils = before?.amountMilliFils ?? 0
    const correctedMilliFils = after?.amountMilliFils ?? 0
    return {
      lineRef,
      tppId: before?.tppId ?? after!.tppId,
      feeClass: before?.feeClass ?? after!.feeClass,
      previousMilliFils,
      correctedMilliFils,
      deltaMilliFils: correctedMilliFils - previousMilliFils
    }
  })

  return {
    period,
    correctionReference,
    reratedAt: assertIsoTimestamp(reratedAt, 'reratedAt'),
    previousRateCardVersion: previousCard.version,
    correctedRateCardVersion: correctedCard.version,
    meteredFactsFingerprint: beforeFingerprint,
    factsUnchanged: beforeFingerprint === afterFingerprint,
    previousTotalMilliFils: previous.totalMilliFils,
    correctedTotalMilliFils: corrected.totalMilliFils,
    totalDeltaMilliFils: corrected.totalMilliFils - previous.totalMilliFils,
    lineDeltas,
    previous,
    corrected
  }
}
