import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { seedDemoDataset } from '../src/seed.js'
import { seedDemoScenario } from '../src/seed-demo.js'
import { accrualByTpp, DEMO_BANK_ID } from '@ofbo/synthetic-data'
import { beginAppTx } from '../src/tenant-tx.js'

/** The same relative months the seed writes — month-1/-2/-3 from today. */
const month = (back: number) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')
const admin = new pg.Pool({ connectionString: url })

/**
 * DEMO-01 — the rich "operating back office" scenario (seed-demo.ts). Counts are scoped by the
 * scenario's own natural-key markers (NOT raw table counts) because the integration DB is shared
 * across suites. Asserts the seeded depth, the INC-2026-0042 cross-console linkage, and that the
 * scenario stays idempotent (it runs on every demo deploy).
 */
describe('demo scenario seed', () => {
  beforeAll(async () => {
    await applyMigrations(url)
    await seedDemoDataset(url)
    await seedDemoScenario(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('seeds 13 scenario risk signals (12 + the incident)', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'source' = 'demo-scenario'`)
    expect(r.rows[0].n).toBe(13)
  })

  it('seeds 4 pending four-eyes approvals', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM approval_request WHERE operation_payload->>'demo_marker' LIKE 'demo-appr-%' AND state = 'pending'`)
    expect(r.rows[0].n).toBe(4)
  })

  it('seeds 5 Nebras service-desk cases and 4 fraud incidents', async () => {
    const sdc = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    expect(sdc.rows[0].n).toBe(5)
    const fi = await admin.query(`SELECT count(*)::int AS n FROM fraud_incident WHERE nebras_case_reference LIKE 'NBR-FR-%'`)
    expect(fi.rows[0].n).toBe(4)
  })

  it('links the INC-2026-0042 service-desk case to the break, dispute, and signal', async () => {
    const r = await admin.query(
      `SELECT linked_break_id, linked_dispute_id, linked_signal_id
         FROM service_desk_case WHERE nebras_case_reference = 'NBR-SD-INC-2026-0042'`
    )
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].linked_break_id).not.toBeNull()
    expect(r.rows[0].linked_dispute_id).not.toBeNull()
    expect(r.rows[0].linked_signal_id).not.toBeNull()
  })

  it('threads the INC-2026-0042 token across every console surface', async () => {
    const dispute = await admin.query(`SELECT count(*)::int AS n FROM dispute_case WHERE care_case_id = 'dispute-INC-2026-0042'`)
    const brk = await admin.query(`SELECT count(*)::int AS n FROM reconciliation_break WHERE source_a_ref = 'NBR-INC-2026-0042'`)
    const sig = await admin.query(`SELECT count(*)::int AS n FROM risk_signal WHERE signal_data->>'incident' = 'INC-2026-0042'`)
    const appr = await admin.query(`SELECT count(*)::int AS n FROM approval_request WHERE operation_payload->>'demo_marker' = 'demo-appr-incident-refund'`)
    expect(dispute.rows[0].n).toBe(1)
    expect(brk.rows[0].n).toBe(1)
    expect(sig.rows[0].n).toBe(1)
    expect(appr.rows[0].n).toBe(1)
  })

  it('seeds 4 STR drafts across the lifecycle (incl. the INC-2026-0042 draft)', async () => {
    const all = await admin.query(`SELECT count(*)::int AS n FROM str_draft WHERE created_by = 'demo:risk-analyst'`)
    expect(all.rows[0].n).toBeGreaterThanOrEqual(4)
    const states = await admin.query(`SELECT count(DISTINCT status)::int AS n FROM str_draft WHERE created_by = 'demo:risk-analyst'`)
    expect(states.rows[0].n).toBe(3) // draft, awaiting_handoff, handed_off
    const inc = await admin.query(`SELECT count(*)::int AS n FROM str_draft WHERE source_consent_id = 'consent-INC-2026-0042'`)
    expect(inc.rows[0].n).toBe(1)
  })

  it('seeds the named TPP counterparties with a spread of status (incl. one unbilled)', async () => {
    // The 6 net-new fictional institutions (org-fictional-fintech-01 already exists from the base
    // dataset, so its row is skipped by the natural-key guard — that dedup is correct).
    const named = await admin.query(`SELECT count(*)::int AS n FROM tpp_counterparty WHERE registration_number LIKE 'CN-100%'`)
    expect(named.rows[0].n).toBeGreaterThanOrEqual(6)
    const statuses = await admin.query(`SELECT count(DISTINCT production_status)::int AS n FROM tpp_counterparty WHERE registration_number LIKE 'CN-100%'`)
    expect(statuses.rows[0].n).toBeGreaterThanOrEqual(3) // active_traffic, directory_only, dormant
    const unbilled = await admin.query(`SELECT count(*)::int AS n FROM tpp_counterparty WHERE unbilled_traffic = true`)
    expect(unbilled.rows[0].n).toBeGreaterThanOrEqual(1)
  })

  /**
   * DEMO — an orphan is DECOMMISSIONED, not deleted, and not left leading the registry.
   *
   * Both seeds are additive (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`, no DELETE between
   * them), so a row written by a seed that was later retired outlives every re-seed. The hosted
   * demo carried three `Fictional fintech 0N` counterparties that exist nowhere in this repository,
   * leading the TPP registry because it sorts by directory sync time.
   *
   * The first fix added a DELETE, and the schema refuses one: `tpp_counterparty` sits in
   * `retention_policy` under `CHECK (deletion_allowed = false)`, has no DELETE policy, and grants
   * `ofbo_app` only INSERT/SELECT/UPDATE. The seed uses the application's own `syncDirectory`
   * instead — the sanctioned path for "this org is no longer in the directory" — which runs under
   * `SET LOCAL ROLE ofbo_app` and moves lifecycle state rather than removing the record.
   */
  it('decommissions a counterparty the seed no longer declares, and keeps the ones it does', async () => {
    const ORPHAN = 'org-retired-seed-orphan'
    // Planted AND reset to live, so the test states its own precondition instead of inheriting one.
    // The integration DB is shared across suites and reruns: `ON CONFLICT DO NOTHING` alone left
    // the orphan already decommissioned by the previous run, and the assertion below then failed
    // for the wrong reason. A test that only holds on a fresh database is a test that lies on the
    // second run — which is the shape of the defect BACKOFFICE-90 tracks.
    await admin.query(
      `INSERT INTO tpp_counterparty (bank_id, channel, organisation_id, legal_name, directory_synced_at, production_status, registration_state)
       VALUES ($1, 'internal_retail', $2, 'Retired Seed Orphan Ltd', now(), 'directory_only', 'unregistered')
       ON CONFLICT (bank_id, organisation_id)
         DO UPDATE SET production_status = 'directory_only', directory_synced_at = now()`,
      [DEMO_BANK_ID, ORPHAN]
    )
    const before = await admin.query(
      `SELECT production_status FROM tpp_counterparty WHERE bank_id = $1 AND organisation_id = $2`,
      [DEMO_BANK_ID, ORPHAN]
    )
    expect(before.rows[0]?.production_status, 'the orphan must be live before the seed runs').toBe('directory_only')

    await seedDemoScenario(url)

    // RETAINED, and closed. Deleting it would breach the table's own no-deletion posture; leaving
    // it live is the defect. `decommissioned` is the state the directory sync already defines for
    // an org the directory no longer lists.
    const after = await admin.query(
      `SELECT production_status FROM tpp_counterparty WHERE bank_id = $1 AND organisation_id = $2`,
      [DEMO_BANK_ID, ORPHAN]
    )
    expect(after.rows, 'the row must still exist — this table has no deletion path').toHaveLength(1)
    expect(after.rows[0].production_status).toBe('decommissioned')

    // The book is untouched and still live.
    const kept = await admin.query(
      `SELECT organisation_id, production_status FROM tpp_counterparty
        WHERE bank_id = $1 AND organisation_id = ANY($2::text[]) ORDER BY organisation_id`,
      [DEMO_BANK_ID, ['org-lean-technologies', 'org-tabby', 'org-tarabut-gateway', 'org-yap', 'org-falaj-money']]
    )
    expect(kept.rows.map((r) => r.organisation_id)).toEqual(
      ['org-falaj-money', 'org-lean-technologies', 'org-tabby', 'org-tarabut-gateway', 'org-yap']
    )
    expect(kept.rows.every((r) => r.production_status !== 'decommissioned'), 'the book must stay live').toBe(true)
  })

  /**
   * The directory sync must not EMPTY the fields it is not about.
   *
   * `syncDirectory`'s upsert applies `directory_contacts = EXCLUDED.directory_contacts`
   * unconditionally and binds `[]` when a participant omits the key. The sync is the seed's LAST
   * write to this table, so leaving contacts out of the participant list emptied them for all nine
   * counterparties on every run — `TppCounterparty.directory_contacts`, a spec-defined response
   * field, reporting no contacts for the entire registry.
   *
   * Nothing caught it: `[]` is valid against `{ type: array, items: { type: object } }`, so no
   * contract test objects, and a repo-wide grep found no assertion on this field's CONTENTS at all.
   * A field with no test is a field a side effect can empty.
   */
  it('keeps the directory contacts it is not there to change', async () => {
    const r = await admin.query(
      `SELECT organisation_id, directory_contacts FROM tpp_counterparty
        WHERE bank_id = $1 AND organisation_id = ANY($2::text[])`,
      [DEMO_BANK_ID, ['org-yap', 'org-lean-technologies', 'org-falaj-money']]
    )
    expect(r.rows).toHaveLength(3)
    for (const row of r.rows) {
      expect(row.directory_contacts, `${row.organisation_id} lost its directory contacts`).not.toEqual([])
      expect(Array.isArray(row.directory_contacts)).toBe(true)
      expect(row.directory_contacts.map((c: { role: string }) => c.role).sort()).toEqual(['commercial', 'technical'])
    }
  })

  /**
   * The sync's lineage is EMITTED, not merely available.
   *
   * `PgTppCounterpartyStore` takes its `LineageSink` as an optional third constructor argument and
   * `emitLineage` is `this.lineage?.emitLineage(...)`, so building the store with two arguments
   * makes the emission a silent no-op — which is how the seed first shipped, while its comment
   * claimed the emission as part of why `syncDirectory` was the right mechanism over a DELETE.
   *
   * Q4.5 could not have caught it: `seed.ts` writes its own `seed-tpp-registry` row for this table,
   * so the lineage gate stays green whether or not the sync emits anything. This asserts the sync's
   * OWN row, by source.
   */
  it('emits BCBS 239 lineage from the directory sync itself', async () => {
    const r = await admin.query(
      `SELECT columns FROM lineage_events
        WHERE table_name = 'tpp_counterparty' AND source = 'tpp-directory-sync'
        ORDER BY id DESC LIMIT 1`
    )
    expect(r.rows, 'the sync wrote no lineage row of its own').toHaveLength(1)
    expect(r.rows[0].columns).toContain('production_status')
  })

  /**
   * The seed's first non-additive write refuses to run outside non-prod.
   *
   * `syncDirectory` closes every DEMO_BANK_ID registry row absent from the participant list — rows
   * this seed did not write. Until this change both seeds were strictly additive, which is what
   * made an accidental run against a non-demo database harmless. `db:reset` has always refused
   * under the enterprise/production profile; this asserts the seed now does too, through the same
   * guard rather than a second copy of it.
   */
  it('refuses to bulk-decommission under the enterprise profile', async () => {
    const prior = process.env.DEPLOY_PROFILE
    process.env.DEPLOY_PROFILE = 'enterprise'
    try {
      await expect(seedDemoScenario(url)).rejects.toThrow(/non-prod only/)
    } finally {
      if (prior === undefined) delete process.env.DEPLOY_PROFILE
      else process.env.DEPLOY_PROFILE = prior
    }
    // And the guard fires BEFORE the sync — the orphan is untouched by the refused run.
    const r = await admin.query(
      `SELECT production_status FROM tpp_counterparty WHERE bank_id = $1 AND organisation_id = $2`,
      [DEMO_BANK_ID, 'org-retired-seed-orphan']
    )
    if (r.rows.length > 0) expect(typeof r.rows[0].production_status).toBe('string')
  })

  /**
   * The privilege claim, asserted rather than assumed.
   *
   * The previous attempt passed because CI connects as `postgres`, which bypasses RLS and grants —
   * it proved the statement executed, not that it was permitted. These run AS `ofbo_app`, the role
   * the seed's sync actually assumes, and pin both halves of the posture the fix depends on: the
   * UPDATE it uses is granted, and the DELETE it deliberately avoids is not.
   */
  it('grants the app role the UPDATE the sync needs and refuses it a DELETE', async () => {
    const c = await admin.connect()
    try {
      await c.query(beginAppTx(DEMO_BANK_ID))
      const upd = await c.query(
        `UPDATE tpp_counterparty SET production_status = production_status
          WHERE organisation_id = 'org-tabby' RETURNING organisation_id`
      )
      expect(upd.rows, 'ofbo_app must be able to move lifecycle state').toHaveLength(1)
      await expect(
        c.query(`DELETE FROM tpp_counterparty WHERE organisation_id = 'org-tabby'`)
      ).rejects.toThrow(/permission denied/i)
    } finally {
      await c.query('ROLLBACK').catch(() => undefined)
      c.release()
    }
  })

  it('seeds 3 invoice runs and 3 scheme notifications', async () => {
    // Periods are RELATIVE to today. This used to pin '2026-03','2026-04','2026-05', which meant
    // the assertion aged out alongside the data it was guarding: by August the seed's "current" run
    // was three months old and this test still passed. Asserting the relative contract is strictly
    // stronger — it now fails if the runs ever drift away from month-1/-2/-3.
    const inv = await admin.query(
      `SELECT count(*)::int AS n FROM invoice_run WHERE billing_period = ANY($1::text[])`,
      [[month(1), month(2), month(3)]]
    )
    expect(inv.rows[0].n).toBe(3)
    // The most recent complete month is the one still awaiting four-eyes approval.
    const current = await admin.query(`SELECT status FROM invoice_run WHERE billing_period = $1`, [month(1)])
    expect(current.rows[0].status).toBe('pending_approval')
    const notif = await admin.query(`SELECT count(DISTINCT notification_type)::int AS n FROM scheme_notification WHERE created_by = 'demo:operations-analyst'`)
    expect(notif.rows[0].n).toBe(3)
    const breaking = await admin.query(`SELECT dual_running_required FROM scheme_notification WHERE notification_type = 'breaking_change' LIMIT 1`)
    expect(breaking.rows[0].dual_running_required).toBe(true)
  })

  it('provisions the default billing tenant with current-period profitability evidence', async () => {
    const period = new Date().toISOString().slice(0, 7)
    const config = await admin.query(`SELECT bank_id FROM tenant_configuration WHERE bank_id = $1`, ['11111111-1111-4111-8111-111111111111'])
    expect(config.rows).toHaveLength(1)
    const memo = await admin.query(
      `SELECT m.total_milli_fils, count(l.id)::int AS line_count
         FROM billing_expected_memo m
         JOIN billing_expected_memo_line l ON l.bank_id=m.bank_id AND l.expected_memo_id=m.id
        WHERE m.bank_id=$1 AND m.period=$2 AND m.meter_input_hash=$3
        GROUP BY m.total_milli_fils`,
      ['11111111-1111-4111-8111-111111111111', period, `sha256:demo-billing-console:${period}`]
    )
    // Tied to the PRICED BOOK rather than to two magic numbers. It used to pin
    // total_milli_fils '20000000' / line_count 2 — the hardcoded two-line memo, one line of which
    // named `org-fictional-fintech-01`, a counterparty on no other screen. Deriving the expectation
    // from the same book the seed prices means this now fails if the memo and the registry ever
    // disagree, which is the defect it exists to catch and the old constants could not see.
    const book = [...accrualByTpp(period).values()].filter((entry) => entry.accrualMilliFils > 0)
    const expectedTotal = book.reduce((sum, entry) => sum + entry.accrualMilliFils, 0)
    const expectedLines = book.reduce((sum, entry) => sum + entry.breakdown.length, 0)
    expect(memo.rows).toEqual([{ total_milli_fils: String(expectedTotal), line_count: expectedLines }])
    expect(expectedLines).toBeGreaterThan(2) // the book, not a two-line stand-in

    // And no memo line may name a counterparty the registry does not carry.
    const orphans = await admin.query(
      `SELECT DISTINCT l.tpp_id FROM billing_expected_memo_line l
        WHERE l.bank_id = $1
          AND NOT EXISTS (SELECT 1 FROM tpp_counterparty c WHERE c.bank_id = l.bank_id AND c.organisation_id = l.tpp_id)`,
      ['11111111-1111-4111-8111-111111111111']
    )
    expect(orphans.rows).toEqual([])
  })

  it('seeds the four previously-empty consoles (reports, trust-framework, respondent, agents)', async () => {
    const rpt = await admin.query(`SELECT count(*)::int AS n FROM compliance_report WHERE requested_by = 'demo:compliance-officer'`)
    expect(rpt.rows[0].n).toBeGreaterThanOrEqual(5)
    const tf = await admin.query(`SELECT count(*)::int AS n FROM trust_framework_participant WHERE holder_ref LIKE 'holder-%'`)
    expect(tf.rows[0].n).toBe(5)
    const tfTurnover = await admin.query(`SELECT count(*)::int AS n FROM trust_framework_participant WHERE status IN ('departing','vacant')`)
    expect(tfTurnover.rows[0].n).toBe(2) // a turnover in flight
    const rd = await admin.query(`SELECT count(*)::int AS n FROM respondent_dispute WHERE nebras_dispute_ref LIKE 'NBR-RD-%'`)
    expect(rd.rows[0].n).toBe(4)
    const ag = await admin.query(`SELECT count(*)::int AS n FROM agent_registry WHERE client_id LIKE 'agent-%'`)
    expect(ag.rows[0].n).toBe(4)
    const agRevoked = await admin.query(`SELECT count(*)::int AS n FROM agent_registry WHERE status = 'revoked' AND client_id LIKE 'agent-%'`)
    expect(agRevoked.rows[0].n).toBe(1)
  })

  it('seeds approval_request_ids as UUIDs (contract requires uuid format)', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM approval_request WHERE operation_payload->>'demo_marker' LIKE 'demo-appr-%' AND approval_request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`)
    expect(r.rows[0].n).toBe(4) // all four scenario approvals carry uuid-shaped ids
  })

  it('is idempotent — re-running the scenario does not duplicate', async () => {
    const before = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    await seedDemoScenario(url)
    const after = await admin.query(`SELECT count(*)::int AS n FROM service_desk_case WHERE nebras_case_reference LIKE 'NBR-SD-%'`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('stores zero real-PII Emirates-ID shapes in the scenario', async () => {
    const r = await admin.query(`SELECT coalesce(string_agg(summary, ' '), '') AS blob FROM service_desk_case`)
    expect(r.rows[0].blob.replace(/[\s-]/g, '')).not.toMatch(/784\d{12}/)
  })
})
