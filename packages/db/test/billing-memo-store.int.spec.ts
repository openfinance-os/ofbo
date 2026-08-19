import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCHEME_RATE_CARD_2026_06_02,
  buildExpectedCollectionMemo,
  canonicalBillingCloudEvent,
  diffCollectionMemo,
  fils,
  meterBillableEvents,
  parseBillingCloudEvent,
  rateUsage,
  rerateClosedPeriod,
  type RateCard
} from '../../billing/src/index.js'
import { billingMeteringFixture } from '../../synthetic-data/src/index.js'
import {
  applyMigrations,
  PgBillingMemoStore,
  PgBillingMeteringStore,
  PgLineageEmitter
} from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

describe('PgBillingMemoStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const metering = new PgBillingMeteringStore(DATABASE_URL!, TENANCY, lineage)
  const store = new PgBillingMemoStore(DATABASE_URL!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
  }, 60_000)

  afterAll(async () => {
    await store.close()
    await metering.close()
    await lineage.close()
  })

  it('persists immutable expectations, memo diffs and rerating replay under tenant RLS', async () => {
    const suffix = randomUUID()
    const events = billingMeteringFixture().slice(0, 5).map((value) => {
      const event = parseBillingCloudEvent(value)
      event.id = `${event.id}-${suffix}`
      event.fapiinteractionid = `${event.fapiinteractionid}-${suffix}`
      event.data.tppId = `${event.data.tppId}-${suffix}`
      return event
    })
    await metering.ingestEvents(events.map((event) => ({
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
    })), suffix)
    const facts = meterBillableEvents(events, SCHEME_RATE_CARD_2026_06_02)
    const inputHash = digest(events.map(canonicalBillingCloudEvent).sort().join('\n'))
    const meterRun = await metering.saveMeterRun({
      period: '2026-06',
      rateCardVersion: SCHEME_RATE_CARD_2026_06_02.version,
      inputHash,
      eventCount: events.length,
      stats: facts.stats,
      evidence: facts.evidence,
      lines: facts.lines
    }, suffix)

    const statement = buildExpectedCollectionMemo(
      rateUsage(facts.lines, SCHEME_RATE_CARD_2026_06_02, '2026-06'),
      '2026-07-03T01:00:00.000Z'
    )
    const expected = await store.saveExpectedMemo({
      meterRunId: meterRun.run.id,
      meterInputHash: inputHash,
      statement
    }, suffix)
    expect(expected.created).toBe(true)
    expect((await store.saveExpectedMemo({ meterRunId: meterRun.run.id, meterInputHash: inputHash, statement }, suffix)).created).toBe(false)
    expect((await store.meteredLinesForRun(meterRun.run.id)).length).toBe(facts.lines.length)

    const memo = {
      reference: `CM-${suffix}`,
      period: '2026-06',
      issuedAt: '2026-07-05T00:00:00.000Z',
      receivedAt: '2026-07-05T08:00:00.000Z',
      lines: statement.lines.map((line, index) => ({
        tppId: line.tppId,
        feeClass: line.feeClass,
        units: line.units,
        amountMilliFils: line.amountMilliFils + (index === 0 ? fils(3) : 0)
      }))
    }
    const diff = diffCollectionMemo(statement, memo, fils(1))
    const savedDiff = await store.saveMemoReconciliation({
      expectedMemoId: expected.record.id,
      memo,
      diff,
      reconciliationRunId: `billing-memo-${suffix}`
    }, suffix)
    expect(savedDiff.created).toBe(true)
    expect((await store.saveMemoReconciliation({ expectedMemoId: expected.record.id, memo, diff, reconciliationRunId: `billing-memo-${suffix}` }, suffix)).created).toBe(false)
    await expect(store.saveMemoReconciliation({
      expectedMemoId: expected.record.id,
      memo: { ...memo, lines: memo.lines.map((line, index) => ({ ...line, amountMilliFils: line.amountMilliFils + (index === 0 ? fils(1) : 0) })) },
      diff,
      reconciliationRunId: `billing-memo-${suffix}`
    }, suffix)).rejects.toThrow(/conflicting Collection Memo/i)

    const corrected = structuredClone(SCHEME_RATE_CARD_2026_06_02) as RateCard
    corrected.version = `integration-correction-${suffix}`
    corrected.receivable['data.corporate_page'].flatMilliFils = fils(50)
    const replay = rerateClosedPeriod(
      facts.lines,
      SCHEME_RATE_CARD_2026_06_02,
      corrected,
      '2026-06',
      `RATE-${suffix}`,
      '2026-08-12T09:00:00.000Z'
    )
    expect((await store.saveRerating({ meterRunId: meterRun.run.id, replay }, suffix)).created).toBe(true)
    expect((await store.saveRerating({ meterRunId: meterRun.run.id, replay }, suffix)).created).toBe(false)

    const otherTenant = new PgBillingMemoStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect(await otherTenant.latestExpectedMemo('2026-06')).toBeNull()
    await expect(otherTenant.saveExpectedMemo({
      meterRunId: meterRun.run.id,
      meterInputHash: inputHash,
      statement
    }, suffix)).rejects.toThrow()
    await otherTenant.close()
  }, 60_000)
})
