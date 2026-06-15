import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgTppCounterpartyStore } from '../src/index.js'

/**
 * BACKOFFICE-71 integration: the directory sync upserts tpp_counterparty under
 * RLS (new → added, legal_name change → changed, dropped → decommissioned),
 * emits BCBS 239 lineage (closing the formerly-allowlisted Q4.5 gap), and
 * list/get are tenant-bound — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const ORG_A = `org-ret-int-a-${randomUUID().slice(0, 8)}`
const ORG_B = `org-ret-int-b-${randomUUID().slice(0, 8)}`

describe('TPP directory sync — RLS upsert + change classification + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgTppCounterpartyStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM tpp_counterparty WHERE organisation_id IN ($1, $2)`, [ORG_A, ORG_B])
  })
  afterAll(async () => {
    await store.close()
    await lineage.close()
    await admin.end()
  })

  it('classifies added / changed / decommissioned across syncs + emits lineage', async () => {
    const t1 = randomUUID()
    const first = await store.syncDirectory(
      [{ organisation_id: ORG_A, legal_name: 'Org A LLC' }, { organisation_id: ORG_B, legal_name: 'Org B Ltd' }],
      t1
    )
    expect(first.added.sort()).toEqual([ORG_A, ORG_B].sort())
    expect(first.changed).toEqual([])

    const rowA = await admin.query(`SELECT legal_name, production_status, registration_state FROM tpp_counterparty WHERE organisation_id = $1`, [ORG_A])
    expect(rowA.rows[0].legal_name).toBe('Org A LLC')
    expect(rowA.rows[0].production_status).toBe('directory_only')
    expect(rowA.rows[0].registration_state).toBe('unregistered')
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'tpp_counterparty'`, [t1])).rows.length).toBeGreaterThan(0)

    // second sync: A renamed, B dropped → changed=[A], decommissioned=[B]
    const t2 = randomUUID()
    const second = await store.syncDirectory([{ organisation_id: ORG_A, legal_name: 'Org A PLC' }], t2)
    expect(second.added).toEqual([])
    expect(second.changed).toEqual([ORG_A])
    expect(second.decommissioned).toContain(ORG_B)
    const rowB = await admin.query(`SELECT production_status FROM tpp_counterparty WHERE organisation_id = $1`, [ORG_B])
    expect(rowB.rows[0].production_status).toBe('decommissioned')

    // list + get are tenant-bound and reflect the rename
    const got = await store.get(ORG_A)
    expect(got?.legal_name).toBe('Org A PLC')
    const page = await store.list({ production_status: 'decommissioned' })
    expect(page.rows.some((r) => r.organisation_id === ORG_B)).toBe(true)
  })
})
