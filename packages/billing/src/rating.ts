import { MF_PER_FIL, bpsOfFils, divideHalfUp } from './money.js'
import {
  steppedValue,
  yearStep,
  type BillingFeeClass,
  type BillingSide,
  type FlatRate,
  type RateCard,
  type ReceivableFeeClass
} from './rate-card.js'

export interface MeteredLine {
  eventId: string
  occurredAt: string
  tppId: string
  traceId?: string
  endpoint?: string
  psuId?: string | null
  direction?: 'inbound' | 'outbound'
  clientId?: string
  counterpartyLfiId?: string
  side: BillingSide
  feeClass: BillingFeeClass
  units: number
  freeUnits?: number
  dataAgeSpanMonths?: number
  valueMilliFils?: number
  chargeableValueMilliFils?: number
  freeValueMilliFils?: number
  batchId?: string
  providers?: number
  paired?: boolean
  merchantId?: string | null
  reclassifiedFrom?: BillingFeeClass
  flag?: 'NO_MERCHANT_ID_NO_EXEMPTION'
}

export interface PricedLine extends MeteredLine {
  amountMilliFils: number
  rateDetail: Record<string, unknown> | null
  batchCappedFromMilliFils?: number
}

export interface StatementLine {
  feeClass: BillingFeeClass
  units: number
  events: number
  amountMilliFils: number
  valueMilliFils: number
}

export interface BillingStatement {
  tppId: string
  receivable: StatementLine[]
  receivableTotalMilliFils: number
}

export interface ClientConfig {
  id: string
  name: string
  markupPercent: number
}

export interface TppAsServiceStatement {
  clientId: string
  name: string
  payableHub: StatementLine[]
  payableLfi: StatementLine[]
  hubMilliFils: number
  lfiMilliFils: number
  costMilliFils: number
  markupPercent: number
  rebillMilliFils: number
  marginMilliFils: number
}

export interface BatchAdjustment {
  batchId: string
  grossMilliFils: number
  cappedMilliFils: number
  savedMilliFils: number
  transactionCount: number
}

export interface RatingResult {
  period: string
  rateCardVersion: string
  yearStep: number
  priced: PricedLine[]
  statements: BillingStatement[]
  tppAsService: TppAsServiceStatement[]
  batchAdjustments: BatchAdjustment[]
  freeToLfiEvents: number
  receivableTotalMilliFils: number
  payableHubTotalMilliFils: number
  payableLfiTotalMilliFils: number
  tppAsServiceRebillMilliFils: number
  tppAsServiceMarginMilliFils: number
}

type RateSpec = RateCard['receivable'][keyof RateCard['receivable']] | RateCard['payableHub'][keyof RateCard['payableHub']]

function assertSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
}

function multiplyMoney(unitAmount: number, units: number): number {
  assertSafeNonNegativeInteger(unitAmount, 'unit amount')
  assertSafeNonNegativeInteger(units, 'units')
  const amount = unitAmount * units
  if (!Number.isSafeInteger(amount)) throw new RangeError('rated amount exceeds safe integer range')
  return amount
}

function priceLine(line: MeteredLine, card: RateCard, step: number): PricedLine {
  assertSafeNonNegativeInteger(line.units, 'units')
  if (line.side === 'free_to_lfi') {
    return {
      ...line,
      amountMilliFils: 0,
      rateDetail: { reason: 'Hub-side fee borne by the consuming TPP; the institution charges nothing' }
    }
  }

  let spec: RateSpec | undefined
  if ((line.side === 'receivable' || line.side === 'payable_lfi') && line.feeClass in card.receivable) {
    spec = card.receivable[line.feeClass as keyof RateCard['receivable']]
  } else if (line.side === 'payable_hub' && line.feeClass in card.payableHub) {
    spec = card.payableHub[line.feeClass as keyof RateCard['payableHub']]
  }
  if (!spec) throw new Error(`No rate-card entry for ${line.side}/${line.feeClass}`)

  let amountMilliFils: number
  let rateDetail: Record<string, unknown> | null = null

  switch (spec.basis) {
    case 'bps_of_value': {
      const basisPoints = steppedValue(spec.scheduleBasisPoints, step)
      const chargeableValueMilliFils = line.chargeableValueMilliFils ?? line.valueMilliFils
      if (chargeableValueMilliFils === undefined) throw new Error(`${line.feeClass} requires a chargeable value`)
      assertSafeNonNegativeInteger(chargeableValueMilliFils, 'chargeable value')
      const uncappedMilliFils = bpsOfFils(divideHalfUp(chargeableValueMilliFils, MF_PER_FIL), basisPoints)
      amountMilliFils = Math.min(uncappedMilliFils, spec.capMilliFils)
      rateDetail = {
        basisPoints,
        capped: uncappedMilliFils > spec.capMilliFils,
        uncappedMilliFils,
        freeValueMilliFils: line.freeValueMilliFils ?? 0
      }
      break
    }
    case 'flat':
      amountMilliFils = multiplyMoney(spec.flatMilliFils, line.units)
      break
    case 'flat_stepped':
      amountMilliFils = multiplyMoney(steppedValue(spec.scheduleMilliFils, step), line.units)
      rateDetail = { step }
      break
    case 'per_page':
      amountMilliFils = multiplyMoney(spec.flatMilliFils, line.units)
      break
    case 'per_page_over_free_tier':
      amountMilliFils = multiplyMoney(spec.overageMilliFils, line.units)
      break
    case 'tiered_by_providers': {
      const providers = line.providers ?? 1
      assertSafeNonNegativeInteger(providers, 'providers')
      const tier = spec.tiers.find(({ maxProviders }) => maxProviders === null || providers <= maxProviders)
      if (!tier) throw new Error(`No provider tier covers ${providers} providers`)
      amountMilliFils = tier.milliFils
      rateDetail = { providers, tier: tier.maxProviders === null ? '>25' : `≤${tier.maxProviders}` }
      break
    }
  }

  return { ...line, amountMilliFils, rateDetail }
}

function applyBatchCaps(priced: PricedLine[], card: RateCard): BatchAdjustment[] {
  const batches = new Map<string, PricedLine[]>()
  for (const line of priced) {
    if (!line.batchId) continue
    const existing = batches.get(line.batchId) ?? []
    existing.push(line)
    batches.set(line.batchId, existing)
  }

  const adjustments: BatchAdjustment[] = []
  for (const [batchId, lines] of batches) {
    const specs = lines.map((line) => card.receivable[line.feeClass as ReceivableFeeClass])
    const caps = specs
      .filter((spec): spec is FlatRate => spec?.basis === 'flat' && spec.batchCapMilliFils !== undefined)
      .map((spec) => spec.batchCapMilliFils as number)
    const distinctCaps = [...new Set(caps)]
    if (distinctCaps.length === 0) continue
    if (distinctCaps.length !== 1 || caps.length !== lines.length) throw new Error(`Batch ${batchId} mixes incompatible fee classes`)

    const cap = distinctCaps[0] as number
    const gross = lines.reduce((sum, line) => sum + line.amountMilliFils, 0)
    if (gross <= cap) continue

    let allocated = 0
    lines.forEach((line, index) => {
      const original = line.amountMilliFils
      const share = index === lines.length - 1 ? cap - allocated : divideHalfUp(original * cap, gross)
      allocated += share
      line.batchCappedFromMilliFils = original
      line.amountMilliFils = share
    })
    adjustments.push({
      batchId,
      grossMilliFils: gross,
      cappedMilliFils: cap,
      savedMilliFils: gross - cap,
      transactionCount: lines.length
    })
  }
  return adjustments
}

function rollup(lines: readonly PricedLine[]): StatementLine[] {
  const totals = new Map<BillingFeeClass, StatementLine>()
  for (const line of lines) {
    const current = totals.get(line.feeClass) ?? {
      feeClass: line.feeClass,
      units: 0,
      events: 0,
      amountMilliFils: 0,
      valueMilliFils: 0
    }
    current.units += line.units
    current.events += 1
    current.amountMilliFils += line.amountMilliFils
    current.valueMilliFils += line.valueMilliFils ?? 0
    totals.set(line.feeClass, current)
  }
  return [...totals.values()].sort((left, right) => right.amountMilliFils - left.amountMilliFils)
}

export function rateUsage(
  meteredLines: readonly MeteredLine[],
  card: RateCard,
  period: string,
  clients: readonly ClientConfig[] = []
): RatingResult {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new RangeError('period must be YYYY-MM')
  const step = yearStep(card, `${period}-15`)
  const priced = meteredLines.map((line) => priceLine(line, card, step))
  const batchAdjustments = applyBatchCaps(priced, card)

  const receivableByTpp = new Map<string, PricedLine[]>()
  const payableByClient = new Map<string, { hub: PricedLine[]; lfi: PricedLine[] }>()
  let freeToLfiEvents = 0

  for (const line of priced) {
    if (line.side === 'receivable') {
      const group = receivableByTpp.get(line.tppId) ?? []
      group.push(line)
      receivableByTpp.set(line.tppId, group)
    } else if (line.side === 'payable_hub' || line.side === 'payable_lfi') {
      const clientId = line.clientId ?? 'UNATTRIBUTED'
      const group = payableByClient.get(clientId) ?? { hub: [], lfi: [] }
      group[line.side === 'payable_hub' ? 'hub' : 'lfi'].push(line)
      payableByClient.set(clientId, group)
    } else {
      freeToLfiEvents += 1
    }
  }

  const statements = [...receivableByTpp].map(([tppId, lines]) => {
    const receivable = rollup(lines)
    return {
      tppId,
      receivable,
      receivableTotalMilliFils: receivable.reduce((sum, line) => sum + line.amountMilliFils, 0)
    }
  }).sort((left, right) => right.receivableTotalMilliFils - left.receivableTotalMilliFils)

  const tppAsService = [...payableByClient].map(([clientId, grouped]) => {
    const payableHub = rollup(grouped.hub)
    const payableLfi = rollup(grouped.lfi)
    const hubMilliFils = payableHub.reduce((sum, line) => sum + line.amountMilliFils, 0)
    const lfiMilliFils = payableLfi.reduce((sum, line) => sum + line.amountMilliFils, 0)
    const metadata = clients.find((client) => client.id === clientId)
    const markupPercent = metadata?.markupPercent ?? 15
    assertSafeNonNegativeInteger(markupPercent, 'markupPercent')
    const costMilliFils = hubMilliFils + lfiMilliFils
    const rebillMilliFils = divideHalfUp(costMilliFils * (100 + markupPercent), 100)
    return {
      clientId,
      name: metadata?.name ?? clientId,
      payableHub,
      payableLfi,
      hubMilliFils,
      lfiMilliFils,
      costMilliFils,
      markupPercent,
      rebillMilliFils,
      marginMilliFils: rebillMilliFils - costMilliFils
    }
  }).sort((left, right) => right.costMilliFils - left.costMilliFils)

  return {
    period,
    rateCardVersion: card.version,
    yearStep: step,
    priced,
    statements,
    tppAsService,
    batchAdjustments,
    freeToLfiEvents,
    receivableTotalMilliFils: statements.reduce((sum, statement) => sum + statement.receivableTotalMilliFils, 0),
    payableHubTotalMilliFils: tppAsService.reduce((sum, statement) => sum + statement.hubMilliFils, 0),
    payableLfiTotalMilliFils: tppAsService.reduce((sum, statement) => sum + statement.lfiMilliFils, 0),
    tppAsServiceRebillMilliFils: tppAsService.reduce((sum, statement) => sum + statement.rebillMilliFils, 0),
    tppAsServiceMarginMilliFils: tppAsService.reduce((sum, statement) => sum + statement.marginMilliFils, 0)
  }
}
