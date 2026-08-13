import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SCHEME_RATE_CARD_2026_06_02 } from '../../billing/src/index.js'
import { applyMigrations, PgBillingRateCardStore, PgLineageEmitter } from '../src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('PgBillingRateCardStore', () => {
  const lineage = new PgLineageEmitter(DATABASE_URL!, TENANCY)
  const store = new PgBillingRateCardStore(DATABASE_URL!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
  }, 60_000)

  afterAll(async () => {
    await store.close()
    await lineage.close()
  })

  it('persists immutable versions, deduplicated snapshots, review workflow state, and lineage', async () => {
    const traceId = randomUUID()
    const version = `integration-${randomUUID()}`
    const effectiveFrom = '2026-08-12'
    const versionInput = {
      version,
      effectiveFrom,
      sourceUrl: SCHEME_RATE_CARD_2026_06_02.source,
      configHash: `sha256:${randomUUID()}`,
      cardConfig: { ...SCHEME_RATE_CARD_2026_06_02, version, effectiveFrom }
    }

    const createdVersion = await store.ensureRateCardVersion(versionInput, traceId)
    expect((await store.ensureRateCardVersion(versionInput, traceId)).id).toBe(createdVersion.id)
    await expect(store.ensureRateCardVersion({ ...versionInput, configHash: 'sha256:different' }, traceId)).rejects.toThrow(/immutable/i)

    const sourceUrl = `https://example.invalid/pricing/${randomUUID()}`
    const before = await store.createSnapshot({
      sourceName: 'Integration pricing source',
      sourceUrl,
      contentHash: 'sha256:before',
      contentText: 'before pricing text',
      httpStatus: 200,
      etag: null,
      lastModified: null,
      capturedAt: '2026-08-11T00:00:00.000Z'
    }, traceId)
    const after = await store.createSnapshot({
      sourceName: 'Integration pricing source',
      sourceUrl,
      contentHash: 'sha256:after',
      contentText: 'after pricing text',
      httpStatus: 200,
      etag: '"v2"',
      lastModified: null,
      capturedAt: '2026-08-12T00:00:00.000Z'
    }, traceId)
    expect((await store.latestSnapshot(sourceUrl))?.id).toBe(after.id)

    const input = {
      sourceName: 'Integration pricing source',
      sourceUrl,
      previousSnapshotId: before.id,
      currentSnapshotId: after.id,
      previousHash: before.contentHash,
      currentHash: after.contentHash,
      detectedAt: after.capturedAt,
      changes: [{ path: 'upstream.contentHash', before: before.contentHash, after: after.contentHash }]
    }
    const opened = await store.createReview(input, traceId)
    expect(opened.created).toBe(true)
    expect((await store.createReview(input, traceId)).created).toBe(false)

    await store.markReviewRecipientNotified(opened.review.id, 'Finance', 'FIN-1', traceId)
    expect((await store.reviewsAwaitingNotification())[0]).toMatchObject({ financeTicketId: 'FIN-1', complianceTicketId: null })
    const notified = await store.markReviewRecipientNotified(opened.review.id, 'Compliance', 'COMP-1', traceId)
    expect(notified).toMatchObject({ status: 'notified', financeTicketId: 'FIN-1', complianceTicketId: 'COMP-1' })

    const otherTenant = new PgBillingRateCardStore(DATABASE_URL!, { ...TENANCY, bankId: randomUUID() })
    expect(await otherTenant.latestSnapshot(sourceUrl)).toBeNull()
    await otherTenant.close()
  }, 60_000)
})
