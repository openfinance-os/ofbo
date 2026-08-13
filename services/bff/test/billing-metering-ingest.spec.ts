import { describe, expect, it } from 'vitest'
import { SCHEME_RATE_CARD_2026_06_02, type BillingCloudEvent } from '@ofbo/billing'
import { billingMeteringFixture } from '@ofbo/synthetic-data'
import {
  BillingMeteringIngestService,
  type BillingMeteringStore,
  type MeterRunWrite
} from '../src/billing/metering-ingest.js'

class MemoryMeteringStore implements BillingMeteringStore {
  readonly events = new Map<string, { hash: string; payload: unknown }>()
  readonly runs = new Map<string, MeterRunWrite & { id: string; createdAt: string }>()

  async ingestEvents(inputs: Parameters<BillingMeteringStore['ingestEvents']>[0]) {
    let inserted = 0
    for (const input of inputs) {
      const existing = this.events.get(input.eventId)
      if (existing && existing.hash !== input.eventHash) throw new Error(`Conflicting duplicate billing CloudEvent id ${input.eventId}`)
      if (!existing) {
        this.events.set(input.eventId, { hash: input.eventHash, payload: input.eventPayload })
        inserted += 1
      }
    }
    return { received: inputs.length, inserted, duplicates: inputs.length - inserted }
  }

  async eventsForPeriod(period: string): Promise<unknown[]> {
    return [...this.events.values()]
      .map(({ payload }) => payload as BillingCloudEvent)
      .filter((entry) => entry.time.startsWith(period))
  }

  async saveMeterRun(input: MeterRunWrite) {
    const key = `${input.period}|${input.rateCardVersion}|${input.inputHash}`
    const existing = this.runs.get(key)
    if (existing) return { run: existing, created: false }
    const run = { ...input, id: `run-${this.runs.size + 1}`, createdAt: '2026-06-30T23:59:59.000Z' }
    this.runs.set(key, run)
    return { run, created: true }
  }
}

describe('BILL-02 metering ingestion', () => {
  it('persists CloudEvents exactly once and does not create a second run for redelivery', async () => {
    const store = new MemoryMeteringStore()
    const service = new BillingMeteringIngestService(store, SCHEME_RATE_CARD_2026_06_02)
    const input = billingMeteringFixture().slice(0, 3)

    const first = await service.ingest(input, 'trace-ingest-1')
    const replay = await service.ingest(input, 'trace-ingest-2')

    expect(first.ingest).toEqual({ received: 3, inserted: 3, duplicates: 0 })
    expect(first.runs).toEqual([expect.objectContaining({ period: '2026-06', created: true })])
    expect(replay.ingest).toEqual({ received: 3, inserted: 0, duplicates: 3 })
    expect(replay.runs).toEqual([expect.objectContaining({ period: '2026-06', created: false })])
    expect(store.runs).toHaveLength(1)
  })

  it('meters the deterministic simulator fixture with pairing, free-tier, merchant and coverage evidence', async () => {
    const store = new MemoryMeteringStore()
    const service = new BillingMeteringIngestService(store, SCHEME_RATE_CARD_2026_06_02)

    const result = await service.ingest(billingMeteringFixture(), 'trace-simulator')
    const run = result.runs[0]

    expect(run).toMatchObject({ period: '2026-06', created: true })
    expect(run?.stats).toMatchObject({ eventsTotal: 10, unknownEndpoints: 1, coveragePercent: 90 })
    expect(run?.evidence).toMatchObject({
      pairing: expect.arrayContaining([expect.objectContaining({ paymentEventId: 'sim-payment' })]),
      freeTier: expect.arrayContaining([expect.objectContaining({ eventId: 'sim-data-a', billablePages: 1 })]),
      merchantAllowance: expect.arrayContaining([expect.objectContaining({ merchantId: 'MER-SIM-1' })]),
      blindSpots: [expect.objectContaining({ eventId: 'sim-unknown' })]
    })
    expect(run?.lines.every((line) => Boolean(line.traceId))).toBe(true)
  })
})
