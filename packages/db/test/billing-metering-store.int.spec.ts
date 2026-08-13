import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  canonicalBillingCloudEvent,
  meterBillableEvents,
  parseBillingCloudEvent
} from '../../billing/src/index.js'
import { billingMeteringFixture } from '../../synthetic-data/src/index.js'
import { applyMigrations, PgBillingMeteringStore, PgLineageEmitter } from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

describe('PgBillingMeteringStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingMeteringStore(DATABASE_URL!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
  }, 60_000)

  afterAll(async () => {
    await store.close()
    await lineage.close()
  })

  it('deduplicates raw events, rejects conflicting IDs, versions replay runs, and enforces RLS', async () => {
    const suffix = randomUUID()
    const events = billingMeteringFixture().slice(0, 5).map((value) => {
      const parsed = parseBillingCloudEvent(value)
      parsed.id = `${parsed.id}-${suffix}`
      parsed.fapiinteractionid = `${parsed.fapiinteractionid}-${suffix}`
      return parsed
    })
    const writes = events.map((event) => ({
      eventId: event.id,
      source: event.source,
      type: event.type,
      occurredAt: event.time,
      eventHash: digest(canonicalBillingCloudEvent(event)),
      eventPayload: event,
      fapiInteractionId: event.fapiinteractionid,
      endpoint: event.data.endpoint,
      outcome: event.data.outcome,
      direction: event.data.direction,
      tppId: event.data.tppId,
      psuId: event.data.psuId
    }))
    const traceId = randomUUID()

    expect(await store.ingestEvents(writes, traceId)).toEqual({ received: 5, inserted: 5, duplicates: 0 })
    expect(await store.ingestEvents(writes, traceId)).toEqual({ received: 5, inserted: 0, duplicates: 5 })
    await expect(store.ingestEvents([{ ...writes[0]!, eventHash: 'sha256:conflict' }], traceId)).rejects.toThrow(/conflicting duplicate/i)

    const persisted = await store.eventsForPeriod('2026-06')
    const scoped = persisted.filter((value) => (value as { id?: string }).id?.endsWith(suffix))
    const metered = meterBillableEvents(scoped, SCHEME_RATE_CARD_2026_06_02)
    const inputHash = digest(scoped.map(canonicalBillingCloudEvent).sort().join('\n'))
    const input = {
      period: '2026-06',
      rateCardVersion: SCHEME_RATE_CARD_2026_06_02.version,
      inputHash,
      eventCount: metered.stats.eventsTotal,
      stats: metered.stats,
      evidence: metered.evidence,
      lines: metered.lines
    }
    const firstRun = await store.saveMeterRun(input, traceId)
    const replay = await store.saveMeterRun(input, traceId)
    expect(firstRun.created).toBe(true)
    expect(replay).toMatchObject({ created: false, run: { id: firstRun.run.id } })
    expect((await store.latestMeterRun('2026-06'))?.inputHash).toBe(inputHash)

    const otherTenant = new PgBillingMeteringStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect((await otherTenant.eventsForPeriod('2026-06')).some((value) => (value as { id?: string }).id?.endsWith(suffix))).toBe(false)
    await otherTenant.close()
  }, 60_000)
})
