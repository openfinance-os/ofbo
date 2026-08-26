import type { MeteredLine } from './rating.js'
import type { RateCard } from './rate-card.js'

export type BillingDirection = 'inbound' | 'outbound'
export type PaymentType = 'merchant_collection' | 'p2p_sme' | 'me_to_me' | 'sme_bulk' | 'large_value' | 'corporate'

export interface BillingGatewayCall {
  endpoint: string
  outcome: number
  direction: BillingDirection
  tppId: string
  psuId: string | null
  clientId?: string
  counterpartyLfiId?: string
  payment?: {
    type: PaymentType
    amountMilliFils: number
    merchantId?: string | null
    batchId?: string
  }
  data?: {
    segment: 'retail' | 'corporate'
    attended: boolean
    lines: number
    ageSpanMonths?: number
  }
  quote?: { providers: number }
}

export interface BillingCloudEvent {
  specversion: '1.0'
  id: string
  source: string
  type: 'com.ofbo.billing.gateway-call.v1'
  subject: string
  time: string
  datacontenttype: 'application/json'
  fapiinteractionid: string
  data: BillingGatewayCall
}

export interface MeteringStats {
  eventsTotal: number
  classified: number
  chargeableEvents: number
  freeEvents: number
  freeToLfiEvents: number
  excludedUnsuccessful: number
  unknownEndpoints: number
  inbound: number
  outbound: number
  coveragePercent: number
}

export interface MeteringResult {
  lines: MeteredLine[]
  delivery: { received: number; accepted: number; duplicates: number }
  stats: MeteringStats
  evidence: {
    pairing: Array<{ paymentEventId: string; pairedEventId: string; endpoint: string; gapHours: number }>
    freeTier: Array<{ eventId: string; psuId: string; day: string; mode: 'attended' | 'unattended'; pages: number; freePages: number; billablePages: number }>
    merchantAllowance: Array<{ eventId: string; merchantId: string; day: string; freeValueMilliFils: number; chargeableValueMilliFils: number }>
    blindSpots: Array<{ eventId: string; endpoint: string; occurredAt: string; tppId: string }>
  }
}

/**
 * Version of the metering PROJECTION itself — the rules turning raw events into metered lines.
 *
 * Meter runs are deduplicated on (bank_id, period, rate_card_version, input_hash), and the input
 * hash covers only the raw CloudEvents. So a change to these rules — the BILL-12 corporate-page
 * and per-serving-LFI free-tier corrections, for instance — produces different lines from
 * byte-identical inputs and would otherwise collide with the stale run and never be written:
 * a silently wrong projection that no gate could see. Folding this version into the hash makes a
 * rules change yield a NEW immutable run instead, leaving the earlier one intact for audit.
 *
 * BUMP THIS whenever meterBillableEvents changes what it emits for unchanged input.
 */
export const METERING_PROJECTION_VERSION = '2026.08.17'

/**
 * Pre-image for a meter run's input hash: the projection version followed by the period's
 * canonical events. Pure, so the ordering and prefix are testable without a hash implementation.
 */
export function meteringInputPreimage(
  canonicalEvents: readonly string[],
  projectionVersion: string = METERING_PROJECTION_VERSION
): string {
  if (!projectionVersion.trim()) throw new RangeError('projectionVersion is required')
  return [`metering-projection:${projectionVersion}`, ...[...canonicalEvents].sort()].join('\n')
}

const PAYMENT_TYPES = new Set<PaymentType>(['merchant_collection', 'p2p_sme', 'me_to_me', 'sme_bulk', 'large_value', 'corporate'])
const DIRECTIONS = new Set<BillingDirection>(['inbound', 'outbound'])
const PAIRABLE_ENDPOINTS = ['GET /accounts/{id}/balances', 'POST /confirmation'] as const

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
  return value as number
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label)
}

function parsePayment(value: unknown): BillingGatewayCall['payment'] {
  if (value === undefined) return undefined
  const input = record(value, 'data.payment')
  const type = requiredString(input.type, 'data.payment.type') as PaymentType
  if (!PAYMENT_TYPES.has(type)) throw new TypeError(`data.payment.type is unsupported: ${type}`)
  const merchantId = input.merchantId === null ? null : optionalString(input.merchantId, 'data.payment.merchantId')
  return {
    type,
    amountMilliFils: nonNegativeInteger(input.amountMilliFils, 'data.payment.amountMilliFils'),
    ...(merchantId !== undefined ? { merchantId } : {}),
    ...(input.batchId !== undefined ? { batchId: requiredString(input.batchId, 'data.payment.batchId') } : {})
  }
}

function parseData(value: unknown): BillingGatewayCall['data'] {
  if (value === undefined) return undefined
  const input = record(value, 'data.data')
  if (input.segment !== 'retail' && input.segment !== 'corporate') throw new TypeError('data.data.segment must be retail or corporate')
  if (typeof input.attended !== 'boolean') throw new TypeError('data.data.attended must be boolean')
  return {
    segment: input.segment,
    attended: input.attended,
    lines: nonNegativeInteger(input.lines, 'data.data.lines'),
    ...(input.ageSpanMonths !== undefined ? { ageSpanMonths: nonNegativeInteger(input.ageSpanMonths, 'data.data.ageSpanMonths') } : {})
  }
}

function parseQuote(value: unknown): BillingGatewayCall['quote'] {
  if (value === undefined) return undefined
  const input = record(value, 'data.quote')
  return { providers: nonNegativeInteger(input.providers, 'data.quote.providers') }
}

/** Validate and normalize the CloudEvent boundary before any billing decision is made. */
export function parseBillingCloudEvent(value: unknown): BillingCloudEvent {
  const input = record(value, 'CloudEvent')
  if (input.specversion !== '1.0') throw new TypeError('specversion must be 1.0')
  if (input.type !== 'com.ofbo.billing.gateway-call.v1') throw new TypeError('type must be com.ofbo.billing.gateway-call.v1')
  if (input.datacontenttype !== 'application/json') throw new TypeError('datacontenttype must be application/json')
  const time = requiredString(input.time, 'time')
  if (!Number.isFinite(Date.parse(time))) throw new TypeError('time must be an ISO-8601 timestamp')
  const rawData = record(input.data, 'data')
  const direction = rawData.direction
  if (!DIRECTIONS.has(direction as BillingDirection)) throw new TypeError('data.direction must be inbound or outbound')
  const psuId = rawData.psuId === null ? null : requiredString(rawData.psuId, 'data.psuId')

  return {
    specversion: '1.0',
    id: requiredString(input.id, 'id'),
    source: requiredString(input.source, 'source'),
    type: 'com.ofbo.billing.gateway-call.v1',
    subject: requiredString(input.subject, 'subject'),
    time: new Date(time).toISOString(),
    datacontenttype: 'application/json',
    fapiinteractionid: requiredString(input.fapiinteractionid, 'fapiinteractionid'),
    data: {
      endpoint: requiredString(rawData.endpoint, 'data.endpoint'),
      outcome: nonNegativeInteger(rawData.outcome, 'data.outcome'),
      direction: direction as BillingDirection,
      tppId: requiredString(rawData.tppId, 'data.tppId'),
      psuId,
      ...(rawData.clientId !== undefined ? { clientId: requiredString(rawData.clientId, 'data.clientId') } : {}),
      ...(rawData.counterpartyLfiId !== undefined ? { counterpartyLfiId: requiredString(rawData.counterpartyLfiId, 'data.counterpartyLfiId') } : {}),
      ...(rawData.payment !== undefined ? { payment: parsePayment(rawData.payment) } : {}),
      ...(rawData.data !== undefined ? { data: parseData(rawData.data) } : {}),
      ...(rawData.quote !== undefined ? { quote: parseQuote(rawData.quote) } : {})
    }
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const input = value as Record<string, unknown>
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`
}

/** Stable semantic representation used for event and replay-set fingerprints. */
export function canonicalBillingCloudEvent(value: unknown): string {
  return canonical(parseBillingCloudEvent(value))
}

function day(timestamp: string): string {
  return timestamp.slice(0, 10)
}

function hoursBetween(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / 3_600_000
}

function eventOrder(left: BillingCloudEvent, right: BillingCloudEvent): number {
  return left.time.localeCompare(right.time) || left.id.localeCompare(right.id)
}

function baseLine(event: BillingCloudEvent): Omit<MeteredLine, 'side' | 'feeClass' | 'units'> {
  return {
    eventId: event.id,
    occurredAt: event.time,
    tppId: event.data.tppId,
    traceId: event.fapiinteractionid,
    endpoint: event.data.endpoint,
    psuId: event.data.psuId,
    direction: event.data.direction,
    ...(event.data.clientId ? { clientId: event.data.clientId } : {}),
    ...(event.data.counterpartyLfiId ? { counterpartyLfiId: event.data.counterpartyLfiId } : {})
  }
}

function requireData(event: BillingCloudEvent): NonNullable<BillingGatewayCall['data']> {
  if (!event.data.data) throw new TypeError(`${event.id} requires data line metadata`)
  if ((event.data.data.ageSpanMonths ?? 0) > 13) throw new RangeError(`${event.id} exceeds the 13-month maximum data span per call`)
  return event.data.data
}

function requirePayment(event: BillingCloudEvent): NonNullable<BillingGatewayCall['payment']> {
  if (!event.data.payment) throw new TypeError(`${event.id} requires payment metadata`)
  return event.data.payment
}

/** Produce immutable metered facts from independently observed gateway events. */
export function meterBillableEvents(deliveries: readonly unknown[], card: RateCard): MeteringResult {
  const byId = new Map<string, { event: BillingCloudEvent; canonical: string }>()
  let duplicates = 0
  for (const delivery of deliveries) {
    const parsed = parseBillingCloudEvent(delivery)
    const encoded = canonical(parsed)
    const existing = byId.get(parsed.id)
    if (existing) {
      if (existing.canonical !== encoded) throw new Error(`Conflicting duplicate billing CloudEvent id ${parsed.id}`)
      duplicates += 1
    } else {
      byId.set(parsed.id, { event: parsed, canonical: encoded })
    }
  }
  const events = [...byId.values()].map(({ event }) => event).sort(eventOrder)
  const stats: MeteringStats = {
    eventsTotal: events.length,
    classified: 0,
    chargeableEvents: 0,
    freeEvents: 0,
    freeToLfiEvents: 0,
    excludedUnsuccessful: 0,
    unknownEndpoints: 0,
    inbound: 0,
    outbound: 0,
    coveragePercent: 0
  }
  const evidence: MeteringResult['evidence'] = { pairing: [], freeTier: [], merchantAllowance: [], blindSpots: [] }

  const buckets = new Map<string, BillingCloudEvent[]>()
  for (const event of events) {
    if (!PAIRABLE_ENDPOINTS.includes(event.data.endpoint as typeof PAIRABLE_ENDPOINTS[number]) || event.data.outcome < 200 || event.data.outcome >= 300) continue
    const key = [event.data.direction, event.data.endpoint, event.data.tppId, event.data.clientId ?? '', event.data.psuId ?? ''].join('|')
    const bucket = buckets.get(key) ?? []
    bucket.push(event)
    buckets.set(key, bucket)
  }

  const paired = new Map<string, string>()
  const windowHours = card.payableHub['hub.paired'].windowHours ?? 2
  for (const paymentEvent of events.filter((candidate) => candidate.data.payment && candidate.data.outcome >= 200 && candidate.data.outcome < 300)) {
    for (const endpoint of PAIRABLE_ENDPOINTS) {
      const key = [paymentEvent.data.direction, endpoint, paymentEvent.data.tppId, paymentEvent.data.clientId ?? '', paymentEvent.data.psuId ?? ''].join('|')
      const candidate = (buckets.get(key) ?? [])
        .filter((call) => !paired.has(call.id) && hoursBetween(call.time, paymentEvent.time) <= windowHours)
        .sort((left, right) => hoursBetween(left.time, paymentEvent.time) - hoursBetween(right.time, paymentEvent.time) || eventOrder(left, right))[0]
      if (candidate) {
        paired.set(candidate.id, paymentEvent.id)
        evidence.pairing.push({
          paymentEventId: paymentEvent.id,
          pairedEventId: candidate.id,
          endpoint,
          gapHours: Number(hoursBetween(candidate.time, paymentEvent.time).toFixed(4))
        })
      }
    }
  }

  const lines: MeteredLine[] = []
  const freeTierUsed = new Map<string, number>()
  const merchantUsed = new Map<string, number>()

  for (const event of events) {
    const call = event.data
    stats[call.direction] += 1
    const kind = card.chargeableEndpoints[call.endpoint]
    if (!kind) {
      if (card.freeEndpoints.includes(call.endpoint)) {
        stats.classified += 1
        stats.freeEvents += 1
      } else {
        stats.unknownEndpoints += 1
        evidence.blindSpots.push({ eventId: event.id, endpoint: call.endpoint, occurredAt: event.time, tppId: call.tppId })
      }
      continue
    }
    stats.classified += 1
    if (call.outcome < 200 || call.outcome >= 300) {
      stats.excludedUnsuccessful += 1
      continue
    }
    const base = baseLine(event)

    if (call.direction === 'outbound') {
      const isPaired = paired.has(event.id)
      lines.push({
        ...base,
        side: 'payable_hub',
        feeClass: kind === 'quote' ? 'hub.quote' : isPaired ? 'hub.paired' : 'hub.standard',
        units: 1,
        paired: isPaired,
        ...(call.quote ? { providers: call.quote.providers } : {})
      })
      stats.chargeableEvents += 1
      if (kind === 'payment') {
        const payment = requirePayment(event)
        lines.push({
          ...base,
          side: 'payable_lfi',
          feeClass: `payment.${payment.type}`,
          units: 1,
          valueMilliFils: payment.amountMilliFils,
          chargeableValueMilliFils: payment.amountMilliFils,
          freeValueMilliFils: 0,
          ...(payment.batchId ? { batchId: payment.batchId } : {})
        })
      } else if (kind === 'data') {
        const data = requireData(event)
        const pages = Math.ceil(data.lines / 100)
        const ageSpan = data.ageSpanMonths !== undefined ? { dataAgeSpanMonths: data.ageSpanMonths } : {}
        if (data.segment === 'corporate') {
          // Corporate data is a scheme-uniform 40 fils/page with NO free allowance, mirroring the
          // inbound branch. Rating it as retail overage understated the payable and wrongly spent a
          // retail free-tier allowance on traffic that has none.
          lines.push({ ...base, side: 'payable_lfi', feeClass: 'data.corporate_page', units: pages, ...ageSpan })
        } else {
          const mode = data.attended ? 'attended' : 'unattended'
          const retail = card.receivable['data.retail_page']
          // Whether each serving LFI grants its own allowance is a rate-card statement, not a
          // metering assumption: the default pools one allowance per customer per day, which is the
          // reading that cannot understate the payable.
          const scope = retail.freeTier.per === 'psu_per_serving_lfi_per_day' ? call.counterpartyLfiId ?? '' : 'ALL_SERVING_LFI'
          const key = `OUT|${scope}|${call.psuId ?? ''}|${day(event.time)}|${mode}`
          const allowance = retail.freeTier[mode]
          const used = freeTierUsed.get(key) ?? 0
          const freePages = Math.max(0, Math.min(allowance - used, pages))
          freeTierUsed.set(key, used + pages)
          lines.push({ ...base, side: 'payable_lfi', feeClass: 'data.retail_page', units: pages - freePages, freeUnits: freePages, ...ageSpan })
        }
      }
      continue
    }

    if (kind === 'payment') {
      const payment = requirePayment(event)
      const line: MeteredLine = {
        ...base,
        side: 'receivable',
        feeClass: `payment.${payment.type}`,
        units: 1,
        valueMilliFils: payment.amountMilliFils,
        ...(payment.batchId ? { batchId: payment.batchId } : {})
      }
      if (payment.type === 'merchant_collection') {
        if (payment.merchantId) {
          const key = `${payment.merchantId}|${day(event.time)}`
          const allowance = card.receivable['payment.merchant_collection'].freeAllowance.valueMilliFils
          const used = merchantUsed.get(key) ?? 0
          const free = Math.max(0, Math.min(allowance - used, payment.amountMilliFils))
          merchantUsed.set(key, used + payment.amountMilliFils)
          line.freeValueMilliFils = free
          line.chargeableValueMilliFils = payment.amountMilliFils - free
          line.merchantId = payment.merchantId
          if (free > 0) evidence.merchantAllowance.push({ eventId: event.id, merchantId: payment.merchantId, day: day(event.time), freeValueMilliFils: free, chargeableValueMilliFils: line.chargeableValueMilliFils })
        } else {
          line.freeValueMilliFils = 0
          line.chargeableValueMilliFils = payment.amountMilliFils
          line.merchantId = null
          line.flag = 'NO_MERCHANT_ID_NO_EXEMPTION'
        }
      }
      const largeValue = card.receivable['payment.large_value']
      if (payment.type === 'large_value' && payment.amountMilliFils < (largeValue.thresholdMilliFils ?? 0)) {
        line.feeClass = 'payment.merchant_collection'
        line.chargeableValueMilliFils = payment.amountMilliFils
        line.freeValueMilliFils = 0
        line.reclassifiedFrom = 'payment.large_value'
      }
      lines.push(line)
      stats.chargeableEvents += 1
    } else if (kind === 'data') {
      const data = requireData(event)
      const pages = Math.ceil(data.lines / 100)
      if (data.segment === 'corporate') {
        lines.push({ ...base, side: 'receivable', feeClass: 'data.corporate_page', units: pages, ...(data.ageSpanMonths !== undefined ? { dataAgeSpanMonths: data.ageSpanMonths } : {}) })
      } else {
        const mode = data.attended ? 'attended' : 'unattended'
        const key = `IN|${call.psuId ?? ''}|${day(event.time)}|${mode}`
        const allowance = card.receivable['data.retail_page'].freeTier[mode]
        const used = freeTierUsed.get(key) ?? 0
        const freePages = Math.max(0, Math.min(allowance - used, pages))
        const billablePages = pages - freePages
        freeTierUsed.set(key, used + pages)
        lines.push({ ...base, side: 'receivable', feeClass: 'data.retail_page', units: billablePages, freeUnits: freePages, ...(data.ageSpanMonths !== undefined ? { dataAgeSpanMonths: data.ageSpanMonths } : {}) })
        if (billablePages > 0 && call.psuId) evidence.freeTier.push({ eventId: event.id, psuId: call.psuId, day: day(event.time), mode, pages, freePages, billablePages })
      }
      stats.chargeableEvents += 1
    } else {
      lines.push({ ...base, side: 'free_to_lfi', feeClass: 'no_lfi_charge', units: 1, paired: paired.has(event.id) })
      stats.freeToLfiEvents += 1
    }
  }

  stats.coveragePercent = stats.eventsTotal === 0 ? 100 : Number(((stats.classified / stats.eventsTotal) * 100).toFixed(2))
  return {
    lines,
    delivery: { received: deliveries.length, accepted: events.length, duplicates },
    stats,
    evidence
  }
}
