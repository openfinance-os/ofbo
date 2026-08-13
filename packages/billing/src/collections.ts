import { MF_PER_AED } from './money.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DAY_MS = 86_400_000

export interface SettlementReceivable {
  invoiceId: string
  tppId: string
  amountMilliFils: number
  ledgerRef: string
}

export interface SettlementPayable {
  payableId: string
  counterpartyId: string
  amountMilliFils: number
  ledgerRef: string
}

export interface SettlementInput {
  settlementReference: string
  period: string
  receivedMilliFils: number
  residueToleranceMilliFils: number
  receivables: SettlementReceivable[]
  payables: SettlementPayable[]
}

export interface SettlementDecompositionLine {
  role: 'lfi_receivable' | 'tpp_of_record_payable'
  sourceId: string
  counterpartyId: string
  signedMilliFils: number
  ledgerRef: string
}

export interface SettlementResidueBreak {
  type: 'settlement_residue'
  settlementReference: string
  period: string
  amountMilliFils: number
  receivableLedgerRefs: string[]
  payableLedgerRefs: string[]
}

export interface SettlementDecomposition {
  settlementReference: string
  period: string
  receivedMilliFils: number
  expectedNetMilliFils: number
  residueMilliFils: number
  residueToleranceMilliFils: number
  lines: SettlementDecompositionLine[]
  break: SettlementResidueBreak | null
}

function assertSafeAmount(value: number, label: string, allowNegative = false): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError(`${label} must be a ${allowNegative ? '' : 'non-negative '}safe integer in milli-fils`)
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`)
  if (values.some((value) => value.trim().length === 0)) throw new Error(`${label} must not be blank`)
}

/**
 * Decompose one scheme cash movement into immutable invoice and payable facts.
 * Positive signed lines are LFI receivables; negative signed lines are
 * TPP-of-record payables. A residue is cash minus the explained net position.
 */
export function decomposeSettlement(input: SettlementInput): SettlementDecomposition {
  if (!input.settlementReference.trim()) throw new Error('settlementReference is required')
  if (!MONTH.test(input.period)) throw new Error('period must be YYYY-MM')
  assertSafeAmount(input.receivedMilliFils, 'receivedMilliFils', true)
  assertSafeAmount(input.residueToleranceMilliFils, 'residueToleranceMilliFils')
  assertUnique(input.receivables.map((line) => line.invoiceId), 'receivable source')
  assertUnique(input.payables.map((line) => line.payableId), 'payable source')
  assertUnique(input.receivables.map((line) => line.ledgerRef), 'receivable ledger reference')
  assertUnique(input.payables.map((line) => line.ledgerRef), 'payable ledger reference')

  const receivableLines: SettlementDecompositionLine[] = input.receivables.map((line) => {
    assertSafeAmount(line.amountMilliFils, `receivable ${line.invoiceId}`)
    return {
      role: 'lfi_receivable',
      sourceId: line.invoiceId,
      counterpartyId: line.tppId,
      signedMilliFils: line.amountMilliFils,
      ledgerRef: line.ledgerRef
    }
  })
  const payableLines: SettlementDecompositionLine[] = input.payables.map((line) => {
    assertSafeAmount(line.amountMilliFils, `payable ${line.payableId}`)
    return {
      role: 'tpp_of_record_payable',
      sourceId: line.payableId,
      counterpartyId: line.counterpartyId,
      signedMilliFils: -line.amountMilliFils,
      ledgerRef: line.ledgerRef
    }
  })
  const lines = [...receivableLines, ...payableLines]
  const expectedNetMilliFils = lines.reduce((sum, line) => sum + line.signedMilliFils, 0)
  assertSafeAmount(expectedNetMilliFils, 'expectedNetMilliFils', true)
  const residueMilliFils = input.receivedMilliFils - expectedNetMilliFils
  assertSafeAmount(residueMilliFils, 'residueMilliFils', true)
  const material = Math.abs(residueMilliFils) > input.residueToleranceMilliFils

  return {
    settlementReference: input.settlementReference,
    period: input.period,
    receivedMilliFils: input.receivedMilliFils,
    expectedNetMilliFils,
    residueMilliFils,
    residueToleranceMilliFils: input.residueToleranceMilliFils,
    lines,
    break: material ? {
      type: 'settlement_residue',
      settlementReference: input.settlementReference,
      period: input.period,
      amountMilliFils: residueMilliFils,
      receivableLedgerRefs: receivableLines.map((line) => line.ledgerRef),
      payableLedgerRefs: payableLines.map((line) => line.ledgerRef)
    } : null
  }
}

export type DirectCollectionRail = 'of_invoice_collection' | 'aani_request_to_pay' | 'uaedds'

/** Eligibility only: the AED 5k–50k overlap is intentional and policy chooses a rail. */
export function eligibleCollectionRails(
  amountMilliFils: number,
  capabilities: { uaeddsMandate: boolean }
): DirectCollectionRail[] {
  assertSafeAmount(amountMilliFils, 'amountMilliFils')
  const rails: DirectCollectionRail[] = []
  if (amountMilliFils > 5_000 * MF_PER_AED) rails.push('of_invoice_collection')
  if (amountMilliFils < 50_000 * MF_PER_AED) rails.push('aani_request_to_pay')
  if (capabilities.uaeddsMandate) rails.push('uaedds')
  return rails
}

export type DunningState = 'current' | 'reminded' | 'overdue' | 'escalated' | 'suspension_risk' | 'settled'
export type DunningActionType = 'none' | 'reminder' | 'overdue_notice' | 'escalation' | 'suspension_risk_notice'

export interface DunningStage {
  state: Exclude<DunningState, 'current' | 'settled'>
  afterDaysOverdue: number
}

export interface DunningPolicy {
  policyRef: string
  stages: DunningStage[]
}

export interface CollectionInvoice {
  invoiceId: string
  tppId: string
  issuedAt: string
  dueAt: string
  amountMilliFils: number
  settledAt: string | null
}

export interface DunningEvaluation {
  invoiceId: string
  tppId: string
  state: DunningState
  daysOverdue: number
  action: { type: DunningActionType; policyRef: string }
}

function epochDay(date: string, label: string): number {
  if (!DATE.test(date)) throw new Error(`${label} must be YYYY-MM-DD`)
  const value = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a real calendar date`)
  }
  return Math.floor(value / DAY_MS)
}

function actionFor(state: DunningState): DunningActionType {
  switch (state) {
    case 'reminded': return 'reminder'
    case 'overdue': return 'overdue_notice'
    case 'escalated': return 'escalation'
    case 'suspension_risk': return 'suspension_risk_notice'
    default: return 'none'
  }
}

export function evaluateDunning(invoice: CollectionInvoice, asOf: string, policy: DunningPolicy): DunningEvaluation {
  assertSafeAmount(invoice.amountMilliFils, 'invoice amountMilliFils')
  if (!policy.policyRef.trim()) throw new Error('dunning policyRef is required')
  const issuedDay = epochDay(invoice.issuedAt, 'issuedAt')
  const dueDay = epochDay(invoice.dueAt, 'dueAt')
  const asOfDay = epochDay(asOf, 'asOf')
  if (dueDay < issuedDay) throw new Error('dueAt must not precede issuedAt')
  const settledDay = invoice.settledAt === null ? null : epochDay(invoice.settledAt, 'settledAt')

  const ordered = [...policy.stages].sort((a, b) => a.afterDaysOverdue - b.afterDaysOverdue)
  if (ordered.length === 0) throw new Error('dunning policy must define at least one stage')
  if (ordered.some((stage) => !Number.isSafeInteger(stage.afterDaysOverdue) || stage.afterDaysOverdue < 0)) {
    throw new Error('dunning thresholds must be non-negative whole days')
  }
  if (new Set(ordered.map((stage) => stage.state)).size !== ordered.length
    || new Set(ordered.map((stage) => stage.afterDaysOverdue)).size !== ordered.length) {
    throw new Error('dunning stages and thresholds must be unique')
  }
  const rank: Record<DunningStage['state'], number> = { reminded: 1, overdue: 2, escalated: 3, suspension_risk: 4 }
  if (ordered.some((stage, index) => index > 0 && rank[stage.state] <= rank[ordered[index - 1]!.state])) {
    throw new Error('dunning stages must follow ladder order')
  }

  const daysOverdue = Math.max(0, asOfDay - dueDay)
  let state: DunningState = settledDay !== null && settledDay <= asOfDay ? 'settled' : 'current'
  if (state !== 'settled') {
    for (const stage of ordered) if (daysOverdue >= stage.afterDaysOverdue) state = stage.state
  }
  return {
    invoiceId: invoice.invoiceId,
    tppId: invoice.tppId,
    state,
    daysOverdue,
    action: { type: actionFor(state), policyRef: policy.policyRef }
  }
}

export interface TppDsoSummary {
  tppId: string
  dsoDays: number
  invoiceCount: number
  openInvoiceCount: number
  openMilliFils: number
}

/** Amount-weighted invoice age, using settlement date or as-of date for open AR. */
export function summarizeDsoByTpp(invoices: CollectionInvoice[], asOf: string): TppDsoSummary[] {
  const asOfDay = epochDay(asOf, 'asOf')
  const grouped = new Map<string, { weightedDays: number; total: number; count: number; openCount: number; open: number }>()
  for (const invoice of invoices) {
    assertSafeAmount(invoice.amountMilliFils, `invoice ${invoice.invoiceId} amountMilliFils`)
    const issuedDay = epochDay(invoice.issuedAt, `invoice ${invoice.invoiceId} issuedAt`)
    const settledDay = invoice.settledAt === null ? null : epochDay(invoice.settledAt, `invoice ${invoice.invoiceId} settledAt`)
    const isOpen = settledDay === null || settledDay > asOfDay
    const endDay = isOpen ? asOfDay : settledDay
    if (endDay < issuedDay) throw new Error(`invoice ${invoice.invoiceId} ends before it was issued`)
    const current = grouped.get(invoice.tppId) ?? { weightedDays: 0, total: 0, count: 0, openCount: 0, open: 0 }
    current.weightedDays += (endDay - issuedDay) * invoice.amountMilliFils
    current.total += invoice.amountMilliFils
    current.count += 1
    if (isOpen) {
      current.openCount += 1
      current.open += invoice.amountMilliFils
    }
    grouped.set(invoice.tppId, current)
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tppId, value]) => ({
    tppId,
    dsoDays: value.total === 0 ? 0 : Math.round(value.weightedDays / value.total),
    invoiceCount: value.count,
    openInvoiceCount: value.openCount,
    openMilliFils: value.open
  }))
}
