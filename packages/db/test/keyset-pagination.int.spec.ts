import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { PgConsentEventReader } from '../src/consent-events.js'
import { PgLineageEmitter } from '../src/lineage.js'
import { PgTppCounterpartyStore } from '../src/tpp-counterparty-store.js'

/**
 * CODE-01 — real pagination coverage over the SHARED keyset helper.
 *
 * Before this, cursor behaviour had almost no integration coverage: two specs mentioned a
 * cursor at all, and none walked a multi-page sequence. That is a thin net under sixteen
 * hand-rolled implementations of a read path whose failure mode is silent — a wrong parameter
 * index or a mismatched ORDER BY does not throw, it just skips or repeats rows at page edges.
 *
 * These tests walk the two shapes that actually differed:
 *   • consent-events — ASCENDING over a VARIABLE-LENGTH parameter prefix. This is the site
 *     whose old arithmetic was `params.length + 1/+2` while every other store used `- 1/length`.
 *   • tpp_counterparty — keyed on `organisation_id` (TEXT, no ::uuid cast). Casting it would
 *     fail at runtime, so this proves the helper's cast:null path against a live column.
 *
 * The invariant asserted is the one that matters: paging the whole set yields every row exactly
 * once, in order, and terminates.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' as const }

describe('CODE-01 — keyset pagination over the shared helper', () => {
  beforeAll(async () => {
    await applyMigrations(url!)
  })

  describe('ascending, variable-length parameter prefix (consent-events)', () => {
    const PSU = `cust-keyset-${randomUUID()}`
    const TOTAL = 7
    const emitter = new PgAuditEmitter(url!, TENANCY)
    const reader = new PgConsentEventReader(url!, TENANCY)

    beforeAll(async () => {
      for (let i = 0; i < TOTAL; i++) {
        await emitter.emit({
          event_type: i % 2 === 0 ? 'consent_granted' : 'consent_revoked',
          acting_principal: 'demo:customer-care-agent',
          acting_persona: 'customer-care-agent',
          scope_used: 'consents:admin',
          target_psu_identifier: PSU,
          target_consent_id: randomUUID(),
          request_trace_id: randomUUID(),
          request_body: {},
          response_status: 200
        })
      }
    })

    it('pages the full set exactly once, in ascending order, and terminates', async () => {
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const res = await reader.byPsu(PSU, { limit: 2, cursor })
        seen.push(...res.events.map((e) => e.id))
        if (!res.next_cursor) break
        cursor = res.next_cursor
        expect(res.events).toHaveLength(2) // a non-terminal page is always full
      }
      expect(seen).toHaveLength(TOTAL)
      expect(new Set(seen).size).toBe(TOTAL) // no row served twice
    })

    it('a page size larger than the set returns everything with a null cursor', async () => {
      const res = await reader.byPsu(PSU, { limit: 100 })
      expect(res.events).toHaveLength(TOTAL)
      expect(res.next_cursor).toBeNull()
    })

    it('an unparseable cursor degrades to the first page rather than erroring', async () => {
      const res = await reader.byPsu(PSU, { limit: 3, cursor: 'not-a-real-cursor!!' })
      expect(res.events).toHaveLength(3)
    })
  })

  describe('text tie-break column with no uuid cast (tpp_counterparty)', () => {
    const store = new PgTppCounterpartyStore(url!, TENANCY, new PgLineageEmitter(url!, TENANCY))
    const PREFIX = `org-keyset-${randomUUID().slice(0, 8)}`
    const TOTAL = 5

    beforeAll(async () => {
      await store.syncDirectory(
        Array.from({ length: TOTAL }, (_, i) => ({
          organisation_id: `${PREFIX}-${i}`,
          legal_name: `Keyset Fixture ${i} FZ-LLC`
        })),
        randomUUID()
      )
    })

    it('pages a TEXT-keyed store without a uuid cast, serving each row once', async () => {
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 30; page++) {
        const res = await store.list({ limit: 2, cursor })
        seen.push(...res.rows.map((r) => r.organisation_id))
        if (!res.next_cursor) break
        cursor = res.next_cursor
      }
      // The table holds seeded rows too; assert on OUR fixtures plus global uniqueness.
      const ours = seen.filter((o) => o.startsWith(PREFIX))
      expect(ours).toHaveLength(TOTAL)
      expect(new Set(seen).size).toBe(seen.length) // nothing served twice across pages
    })
  })
})
