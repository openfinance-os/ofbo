import { describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  SCHEME_CHARGEABLE_ENDPOINTS_V2_1,
  SCHEME_FREE_ENDPOINTS_V2_1,
  aed,
  meterBillableEvents,
  parseBillingCloudEvent,
  type BillingCloudEvent,
  type BillingGatewayCall
} from '../src/index.js'

function event(id: string, time: string, data: Partial<BillingGatewayCall> = {}): BillingCloudEvent {
  return {
    specversion: '1.0',
    id,
    source: 'urn:ofbo:gateway:alpha-bank',
    type: 'com.ofbo.billing.gateway-call.v1',
    subject: data.tppId ?? 'tpp-a',
    time,
    datacontenttype: 'application/json',
    fapiinteractionid: `trace-${id}`,
    data: {
      endpoint: 'POST /payments',
      outcome: 200,
      direction: 'inbound',
      tppId: 'tpp-a',
      psuId: 'PSU-9990001',
      payment: { type: 'p2p_sme', amountMilliFils: aed(100) },
      ...data
    }
  }
}

describe('BILL-02 CloudEvent boundary', () => {
  it('encodes the complete 50-chargeable/26-free v2.1 endpoint table', () => {
    expect(Object.keys(SCHEME_CHARGEABLE_ENDPOINTS_V2_1)).toHaveLength(50)
    expect(SCHEME_FREE_ENDPOINTS_V2_1).toHaveLength(26)
    expect(Object.keys(SCHEME_CHARGEABLE_ENDPOINTS_V2_1).filter((endpoint) => SCHEME_FREE_ENDPOINTS_V2_1.includes(endpoint))).toEqual([])
  })

  it('accepts a well-formed gateway event and rejects missing traceability', () => {
    expect(parseBillingCloudEvent(event('evt-1', '2026-06-01T10:00:00Z'))).toMatchObject({
      specversion: '1.0',
      id: 'evt-1',
      fapiinteractionid: 'trace-evt-1'
    })

    const invalid = { ...event('evt-1', '2026-06-01T10:00:00Z'), fapiinteractionid: '' }
    expect(() => parseBillingCloudEvent(invalid)).toThrow(/fapiinteractionid/i)
  })

  it('deduplicates identical delivery and fails closed on conflicting reuse of an event id', () => {
    const original = event('evt-1', '2026-06-01T10:00:00Z')
    const result = meterBillableEvents([original, structuredClone(original)], SCHEME_RATE_CARD_2026_06_02)

    expect(result.delivery).toEqual({ received: 2, accepted: 1, duplicates: 1 })
    expect(result.lines).toHaveLength(1)

    const conflict = event('evt-1', '2026-06-01T10:00:00Z', {
      payment: { type: 'p2p_sme', amountMilliFils: aed(200) }
    })
    expect(() => meterBillableEvents([original, conflict], SCHEME_RATE_CARD_2026_06_02)).toThrow(/conflicting duplicate/i)
  })
})

describe('BILL-02 deterministic metering', () => {
  it('produces byte-equivalent meters regardless of delivery order', () => {
    const calls = [
      event('evt-2', '2026-06-01T10:01:00Z'),
      event('evt-1', '2026-06-01T10:00:00Z')
    ]

    const forward = meterBillableEvents(calls, SCHEME_RATE_CARD_2026_06_02)
    const replay = meterBillableEvents([...calls].reverse(), SCHEME_RATE_CARD_2026_06_02)

    expect(replay).toEqual(forward)
    expect(forward.lines.map((line) => line.eventId)).toEqual(['evt-1', 'evt-2'])
  })

  it('classifies free, unknown and technically unsuccessful traffic in coverage without billing it', () => {
    const result = meterBillableEvents([
      event('charged', '2026-06-01T10:00:00Z'),
      event('failed', '2026-06-01T10:01:00Z', { outcome: 503 }),
      event('free', '2026-06-01T10:02:00Z', { endpoint: 'POST /par', payment: undefined }),
      event('unknown', '2026-06-01T10:03:00Z', { endpoint: 'GET /new-scheme-resource', payment: undefined })
    ], SCHEME_RATE_CARD_2026_06_02)

    expect(result.stats).toMatchObject({
      eventsTotal: 4,
      classified: 3,
      chargeableEvents: 1,
      freeEvents: 1,
      excludedUnsuccessful: 1,
      unknownEndpoints: 1,
      coveragePercent: 75
    })
    expect(result.lines).toHaveLength(1)
    expect(result.evidence.blindSpots).toEqual([
      expect.objectContaining({ eventId: 'unknown', endpoint: 'GET /new-scheme-resource' })
    ])
  })

  it('rounds data pages up and applies attended and unattended free tiers per PSU per day', () => {
    const data = (id: string, time: string, attended: boolean, lines: number) => event(id, time, {
      endpoint: 'GET /accounts/{id}/transactions',
      payment: undefined,
      data: { segment: 'retail', attended, lines }
    })
    const calls = [
      data('attended-a', '2026-06-01T08:00:00Z', true, 1_401),
      data('attended-b', '2026-06-01T09:00:00Z', true, 1),
      data('unattended-a', '2026-06-01T10:00:00Z', false, 450),
      data('unattended-b', '2026-06-01T11:00:00Z', false, 1),
      data('next-day', '2026-06-02T08:00:00Z', false, 1)
    ]

    const result = meterBillableEvents(calls, SCHEME_RATE_CARD_2026_06_02)
    const byId = Object.fromEntries(result.lines.map((line) => [line.eventId, line]))

    expect(byId['attended-a']).toMatchObject({ units: 0, freeUnits: 15 })
    expect(byId['attended-b']).toMatchObject({ units: 1, freeUnits: 0 })
    expect(byId['unattended-a']).toMatchObject({ units: 0, freeUnits: 5 })
    expect(byId['unattended-b']).toMatchObject({ units: 1, freeUnits: 0 })
    expect(byId['next-day']).toMatchObject({ units: 0, freeUnits: 1 })
  })

  it('fails closed when a data call exceeds the scheme maximum 13-month age span', () => {
    const invalid = event('too-wide', '2026-06-01T08:00:00Z', {
      endpoint: 'GET /accounts/{id}/transactions',
      payment: undefined,
      data: { segment: 'retail', attended: true, lines: 100, ageSpanMonths: 14 }
    })

    expect(() => meterBillableEvents([invalid], SCHEME_RATE_CARD_2026_06_02)).toThrow(/13-month maximum/i)
  })

  it('pairs at most one balance and one CoP call per payment within two hours', () => {
    const outbound = { direction: 'outbound' as const, tppId: 'SELF', clientId: 'client-a' }
    const result = meterBillableEvents([
      event('balance-near', '2026-06-01T09:30:00Z', { ...outbound, endpoint: 'GET /accounts/{id}/balances', payment: undefined }),
      event('balance-far', '2026-06-01T06:00:00Z', { ...outbound, endpoint: 'GET /accounts/{id}/balances', payment: undefined }),
      event('cop-near', '2026-06-01T09:45:00Z', { ...outbound, endpoint: 'POST /confirmation', payment: undefined }),
      event('payment', '2026-06-01T10:00:00Z', { ...outbound }),
      event('payment-2', '2026-06-01T10:15:00Z', { ...outbound })
    ], SCHEME_RATE_CARD_2026_06_02)

    const hubLines = result.lines.filter((line) => line.side === 'payable_hub')
    expect(hubLines.find((line) => line.eventId === 'balance-near')).toMatchObject({ feeClass: 'hub.paired', paired: true })
    expect(hubLines.find((line) => line.eventId === 'cop-near')).toMatchObject({ feeClass: 'hub.paired', paired: true })
    expect(hubLines.find((line) => line.eventId === 'balance-far')).toMatchObject({ feeClass: 'hub.standard', paired: false })
    expect(result.evidence.pairing).toHaveLength(2)
  })

  it('applies the Merchant-ID-gated daily allowance and records absent Merchant IDs', () => {
    const merchant = (id: string, time: string, amount: number, merchantId: string | null) => event(id, time, {
      payment: { type: 'merchant_collection', amountMilliFils: aed(amount), merchantId }
    })
    const result = meterBillableEvents([
      merchant('a', '2026-06-01T08:00:00Z', 150, 'MER-1'),
      merchant('b', '2026-06-01T09:00:00Z', 100, 'MER-1'),
      merchant('c', '2026-06-01T10:00:00Z', 100, null)
    ], SCHEME_RATE_CARD_2026_06_02)
    const byId = Object.fromEntries(result.lines.map((line) => [line.eventId, line]))

    expect(byId.a).toMatchObject({ freeValueMilliFils: aed(150), chargeableValueMilliFils: 0 })
    expect(byId.b).toMatchObject({ freeValueMilliFils: aed(50), chargeableValueMilliFils: aed(50) })
    expect(byId.c).toMatchObject({ freeValueMilliFils: 0, chargeableValueMilliFils: aed(100), flag: 'NO_MERCHANT_ID_NO_EXEMPTION' })
  })

  it('carries the FAPI trace and quote provider fan-out onto every resulting line', () => {
    const result = meterBillableEvents([
      event('quote', '2026-06-01T12:00:00Z', {
        direction: 'outbound',
        tppId: 'SELF',
        clientId: 'client-a',
        endpoint: 'POST /motor-insurance-quotes',
        payment: undefined,
        quote: { providers: 26 }
      })
    ], SCHEME_RATE_CARD_2026_06_02)

    expect(result.lines).toEqual([
      expect.objectContaining({ eventId: 'quote', traceId: 'trace-quote', feeClass: 'hub.quote', providers: 26 })
    ])
  })
})
