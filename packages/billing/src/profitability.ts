import { divideHalfUp, MF_PER_AED } from './money.js'

export type BillingProductFamily = 'payments' | 'data' | 'confirmation_of_payee' | 'tpp_aas' | 'other'

export interface ProfitabilityLine {
  tppId: string
  productFamily: BillingProductFamily
  amountMilliFils: number
  sourceRefs: string[]
}

export interface ProfitabilityInput {
  period: string
  receivables: ProfitabilityLine[]
  hubCosts: ProfitabilityLine[]
  liabilityProvisions: ProfitabilityLine[]
  tppAasMargins: ProfitabilityLine[]
}

export interface ProfitabilityAmounts {
  receivableMilliFils: number
  hubCostMilliFils: number
  liabilityProvisionMilliFils: number
  tppAasMarginMilliFils: number
  profitMilliFils: number
}

export interface ProfitabilityRow extends ProfitabilityAmounts {
  tppId?: string
  productFamily?: BillingProductFamily
  sourceRefs: string[]
  profitAed: number
}

export interface ProfitabilityReport {
  period: string
  currency: 'AED'
  totals: ProfitabilityAmounts
  byTpp: ProfitabilityRow[]
  byProductFamily: ProfitabilityRow[]
  reconciliation: { balanced: boolean; deltaMilliFils: number }
}

export interface FeeScenario {
  scenarioId: string
  effectiveDate: string
  /** 10_000 = unchanged; 10_500 = +5%. */
  receivableMultiplierBasisPoints: number
  retailOverage: {
    overageUnits: number
    currentRateMilliFils: number
    proposedRateMilliFils: number
  }
}

export interface FeeScenarioResult {
  scenarioId: string
  effectiveDate: string
  baseline: ProfitabilityAmounts
  projected: ProfitabilityAmounts
  deltaProfitMilliFils: number
  overage: {
    units: number
    silentDefaultRevenueMilliFils: number
    proposedRevenueMilliFils: number
    incrementalRevenueMilliFils: number
  }
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new RangeError(`${label} exceeds the safe integer range`)
  return total
}

function empty(): ProfitabilityAmounts {
  return { receivableMilliFils: 0, hubCostMilliFils: 0, liabilityProvisionMilliFils: 0, tppAasMarginMilliFils: 0, profitMilliFils: 0 }
}

function withProfit(value: Omit<ProfitabilityAmounts, 'profitMilliFils'>): ProfitabilityAmounts {
  const profitMilliFils = value.receivableMilliFils - value.hubCostMilliFils - value.liabilityProvisionMilliFils + value.tppAasMarginMilliFils
  if (!Number.isSafeInteger(profitMilliFils)) throw new RangeError('profit exceeds the safe integer range')
  return { ...value, profitMilliFils }
}

function validateLines(lines: readonly ProfitabilityLine[], label: string): void {
  for (const [index, line] of lines.entries()) {
    if (!line.tppId.trim()) throw new RangeError(`${label}[${index}].tppId cannot be empty`)
    assertMoney(line.amountMilliFils, `${label}[${index}].amountMilliFils`)
    if (line.sourceRefs.length === 0 || line.sourceRefs.some((ref) => !ref.trim())) {
      throw new RangeError(`${label}[${index}].sourceRefs must contain evidence references`)
    }
  }
}

function addLine(amounts: ProfitabilityAmounts, kind: keyof Omit<ProfitabilityAmounts, 'profitMilliFils'>, line: ProfitabilityLine): void {
  amounts[kind] = safeAdd(amounts[kind], line.amountMilliFils, kind)
}

function aggregate(
  input: ProfitabilityInput,
  keyOf: (line: ProfitabilityLine) => string
): Map<string, { amounts: ProfitabilityAmounts; refs: Set<string> }> {
  const groups = new Map<string, { amounts: ProfitabilityAmounts; refs: Set<string> }>()
  const apply = (lines: readonly ProfitabilityLine[], kind: keyof Omit<ProfitabilityAmounts, 'profitMilliFils'>) => {
    for (const line of lines) {
      const key = keyOf(line)
      const group = groups.get(key) ?? { amounts: empty(), refs: new Set<string>() }
      addLine(group.amounts, kind, line)
      for (const ref of line.sourceRefs) group.refs.add(ref)
      groups.set(key, group)
    }
  }
  apply(input.receivables, 'receivableMilliFils')
  apply(input.hubCosts, 'hubCostMilliFils')
  apply(input.liabilityProvisions, 'liabilityProvisionMilliFils')
  apply(input.tppAasMargins, 'tppAasMarginMilliFils')
  return groups
}

/** BILL-09: deterministic P&L from evidence lines; no persistence and no input mutation. */
export function buildProfitabilityReport(input: ProfitabilityInput): ProfitabilityReport {
  if (!PERIOD.test(input.period)) throw new RangeError('period must be YYYY-MM')
  validateLines(input.receivables, 'receivables')
  validateLines(input.hubCosts, 'hubCosts')
  validateLines(input.liabilityProvisions, 'liabilityProvisions')
  validateLines(input.tppAasMargins, 'tppAasMargins')

  const totals = empty()
  for (const line of input.receivables) addLine(totals, 'receivableMilliFils', line)
  for (const line of input.hubCosts) addLine(totals, 'hubCostMilliFils', line)
  for (const line of input.liabilityProvisions) addLine(totals, 'liabilityProvisionMilliFils', line)
  for (const line of input.tppAasMargins) addLine(totals, 'tppAasMarginMilliFils', line)
  const finalTotals = withProfit(totals)

  const toRows = (groups: Map<string, { amounts: ProfitabilityAmounts; refs: Set<string> }>, dimension: 'tppId' | 'productFamily') =>
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
      const amounts = withProfit(value.amounts)
      return {
        [dimension]: key,
        ...amounts,
        sourceRefs: [...value.refs].sort(),
        profitAed: amounts.profitMilliFils / MF_PER_AED
      } as ProfitabilityRow
    })

  const byTpp = toRows(aggregate(input, (line) => line.tppId), 'tppId')
  const byProductFamily = toRows(aggregate(input, (line) => line.productFamily), 'productFamily')
  const detailProfit = byTpp.reduce((sum, row) => safeAdd(sum, row.profitMilliFils, 'TPP profit total'), 0)
  const deltaMilliFils = finalTotals.profitMilliFils - detailProfit
  return {
    period: input.period,
    currency: 'AED',
    totals: finalTotals,
    byTpp,
    byProductFamily,
    reconciliation: { balanced: deltaMilliFils === 0, deltaMilliFils }
  }
}

function multiplyBasisPoints(amount: number, basisPoints: number): number {
  const product = amount * basisPoints
  if (!Number.isSafeInteger(product)) throw new RangeError('scenario multiplication exceeds safe integer range')
  return divideHalfUp(product, 10_000)
}

/** Side-effect-free fee simulation. It changes revenue only; booked costs/provisions remain evidence facts. */
export function simulateFeeScenario(input: ProfitabilityInput, scenario: FeeScenario): FeeScenarioResult {
  const report = buildProfitabilityReport(input)
  if (!scenario.scenarioId.trim()) throw new RangeError('scenarioId cannot be empty')
  if (!DATE.test(scenario.effectiveDate) || Number.isNaN(Date.parse(`${scenario.effectiveDate}T00:00:00.000Z`))) {
    throw new RangeError('effectiveDate must be a valid YYYY-MM-DD date')
  }
  if (!Number.isSafeInteger(scenario.receivableMultiplierBasisPoints) || scenario.receivableMultiplierBasisPoints < 0) {
    throw new RangeError('receivableMultiplierBasisPoints must be a non-negative safe integer')
  }
  assertMoney(scenario.retailOverage.overageUnits, 'retailOverage.overageUnits')
  assertMoney(scenario.retailOverage.currentRateMilliFils, 'retailOverage.currentRateMilliFils')
  assertMoney(scenario.retailOverage.proposedRateMilliFils, 'retailOverage.proposedRateMilliFils')

  const current = scenario.retailOverage.overageUnits * scenario.retailOverage.currentRateMilliFils
  const proposed = scenario.retailOverage.overageUnits * scenario.retailOverage.proposedRateMilliFils
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(proposed)) throw new RangeError('overage scenario exceeds safe integer range')
  const projectedRevenue = safeAdd(
    multiplyBasisPoints(report.totals.receivableMilliFils, scenario.receivableMultiplierBasisPoints),
    proposed - current,
    'projected receivable'
  )
  if (projectedRevenue < 0) throw new RangeError('projected receivable cannot be negative')
  const projected = withProfit({
    receivableMilliFils: projectedRevenue,
    hubCostMilliFils: report.totals.hubCostMilliFils,
    liabilityProvisionMilliFils: report.totals.liabilityProvisionMilliFils,
    tppAasMarginMilliFils: report.totals.tppAasMarginMilliFils
  })
  return {
    scenarioId: scenario.scenarioId,
    effectiveDate: scenario.effectiveDate,
    baseline: report.totals,
    projected,
    deltaProfitMilliFils: projected.profitMilliFils - report.totals.profitMilliFils,
    overage: {
      units: scenario.retailOverage.overageUnits,
      silentDefaultRevenueMilliFils: current,
      proposedRevenueMilliFils: proposed,
      incrementalRevenueMilliFils: proposed - current
    }
  }
}
