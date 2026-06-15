import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgLineageEmitter, PgTppCounterpartyStore } from '../src/index.js'

/**
 * BACKOFFICE-72 integration: financial-system registration + traffic observation
 * transition tpp_counterparty under RLS, emit lineage, and correctly set/clear
 * the unbilled-traffic flag — against real Postgres.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }
const ORG = `org-onb-int-${randomUUID().slice(0, 8)}`

describe('TPP onboarding — register + observe-traffic transitions + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const store = new PgTppCounterpartyStore(url!, TENANCY, lineage)

  beforeAll(async () => {
    await applyMigrations(url!)
    await admin.query(`DELETE FROM tpp_counterparty WHERE organisation_id = $1`, [ORG])
    await store.syncDirectory([{ organisation_id: ORG, legal_name: 'Onboarding Co LLC' }], randomUUID())
  })
  afterAll(async () => {
    await store.close()
    await lineage.close()
    await admin.end()
  })

  it('observe-before-register flags unbilled_traffic; register clears it + sets the P9 ref', async () => {
    // traffic observed while still unregistered → unbilled_traffic true, active_traffic, first_traffic stamped
    const t1 = randomUUID()
    const observed = await store.observeTraffic(ORG, t1)
    expect(observed?.production_status).toBe('active_traffic')
    expect(observed?.unbilled_traffic).toBe(true)
    expect(observed?.first_traffic_at).toBeTruthy()
    expect((await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'tpp_counterparty'`, [t1])).rows.length).toBeGreaterThan(0)

    // register in P9 → registered, ref set, unbilled cleared
    const registered = await store.registerFinancialSystem(ORG, 'fms-onb-123', randomUUID())
    expect(registered?.registration_state).toBe('registered')
    expect(registered?.financial_system_ref).toBe('fms-onb-123')
    expect(registered?.unbilled_traffic).toBe(false)

    // further traffic after registration does NOT re-raise the alert
    const again = await store.observeTraffic(ORG, randomUUID())
    expect(again?.unbilled_traffic).toBe(false)

    const row = await admin.query(`SELECT registration_state, financial_system_ref, unbilled_traffic, production_status FROM tpp_counterparty WHERE organisation_id = $1`, [ORG])
    expect(row.rows[0].registration_state).toBe('registered')
    expect(row.rows[0].financial_system_ref).toBe('fms-onb-123')
    expect(row.rows[0].unbilled_traffic).toBe(false)
    expect(row.rows[0].production_status).toBe('active_traffic')
  })
})
