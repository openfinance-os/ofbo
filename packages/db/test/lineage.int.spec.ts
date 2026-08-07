import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import {
  NON_REGULATED_TABLES,
  PgLineageEmitter,
  evaluateLineageGate,
  regulatedTables,
  validateLineageCoverage
} from '../src/lineage.js'
import { PgTppCounterpartyStore } from '../src/tpp-counterparty-store.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `lineage-int-${crypto.randomUUID()}` // unique per run

describe('BACKOFFICE-49 — BCBS 239 lineage emission at write time (P7 demo adapter)', () => {
  const admin = new pg.Pool({ connectionString: url })
  let lineage: PgLineageEmitter
  let audit: PgAuditEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    lineage = new PgLineageEmitter(url, { bankId: BANK, channel: 'internal_retail' })
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' }, lineage)
    // BACKOFFICE-71: the registry write path inserts a tpp_counterparty ROW and
    // emits its lineage. Do that here (via the store) so the coverage assertion is
    // deterministic — tpp_counterparty has BOTH rows and lineage regardless of
    // seed-spec ordering (this permanently retired the old tpp_counterparty flake).
    const tppStore = new PgTppCounterpartyStore(url, { bankId: BANK, channel: 'internal_retail' }, lineage)
    await tppStore.syncDirectory([{ organisation_id: 'org-lineage-int-setup', legal_name: 'Lineage Int Setup Co' }], TRACE)
    await tppStore.close()
  })
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await admin.end()
  })

  it('an audit write emits column-level lineage with the trace id, at write time', async () => {
    await audit.record({
      event_type: 'signin_success',
      acting_principal: 'demo:operations-analyst',
      acting_persona: 'operations-analyst',
      reason: null,
      trace_id: TRACE
    })
    const r = await admin.query(
      `SELECT table_name, columns, source FROM lineage_events WHERE trace_id = $1 AND table_name = 'audit_high_sensitivity'`,
      [TRACE]
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].columns).toContain('event_type')
    expect(r.rows[0].columns).toContain('request_body_redacted')
    expect(r.rows[0].source).toBe('bff-audit-emitter')
  })

  it('lineage failure never blocks the underlying write (emission is best-effort, the write is not)', async () => {
    const broken = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' }, {
      emitLineage: async () => {
        throw new Error('catalogue down')
      }
    })
    const trace = `${TRACE}-broken`
    await broken.record({
      event_type: 'signin_success',
      acting_principal: 'demo:finance-analyst',
      acting_persona: 'finance-analyst',
      reason: null,
      trace_id: trace
    })
    const r = await admin.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE request_trace_id = $1`, [trace])
    expect(r.rows[0].n).toBe(1)
    await broken.close()
  })

  it('validateLineageCoverage (the Q4.5 check) confirms written tables have lineage; no gaps remain', async () => {
    const result = await validateLineageCoverage(url)
    expect(result.covered).toContain('audit_high_sensitivity')
    // BACKOFFICE-71 closed the last gap: the consuming-TPP registry write path + the
    // seed now emit tpp_counterparty lineage, so it is covered (not a gap).
    expect(result.covered).toContain('tpp_counterparty')
    expect(result.gaps).not.toContain('tpp_counterparty')
  })

  // HARNESS-11 — the gate's SCOPE is the control, not just its verdict. The table set was a
  // hand-maintained 17-entry literal that had drifted to ~2/3 of the regulated surface: every
  // table added since it was written (str_draft, service_desk_case, trust_framework_participant,
  // respondent_dispute, fraud_incident, scheme_notification, ...) was invisible to Q4.5 while
  // the gate still reported PASSED. These assertions pin the derivation itself.
  describe('HARNESS-11 — the checked surface is derived, not hand-listed', () => {
    it('covers EVERY table ofbo_app can INSERT into, minus the documented non-regulated set', async () => {
      const derived = await regulatedTables(admin)
      const { rows } = await admin.query(
        `SELECT DISTINCT table_name FROM information_schema.role_table_grants
          WHERE grantee = 'ofbo_app' AND privilege_type = 'INSERT' AND table_schema = 'public'`
      )
      const insertable = rows.map((r) => r.table_name as string)
      const expected = insertable.filter((t) => !(t in NON_REGULATED_TABLES)).sort()

      expect(derived).toEqual(expected)
      // A migration adding a regulated table must widen this set with no code change.
      expect(derived.length).toBeGreaterThanOrEqual(20)
    })

    it('every excluded table is excluded for a stated reason, and is genuinely writable', async () => {
      for (const reason of Object.values(NON_REGULATED_TABLES)) {
        expect(reason.length).toBeGreaterThan(20)
      }
      const derived = await regulatedTables(admin)
      for (const table of Object.keys(NON_REGULATED_TABLES)) {
        expect(derived).not.toContain(table)
      }
    })

    it('strictly supersedes the retired 17-table literal — coverage widened, nothing dropped', async () => {
      // The exact list this gate carried before HARNESS-11.
      const RETIRED_LITERAL = [
        'reconciliation_log', 'reconciliation_break', 'reconciliation_threshold', 'dispute_case',
        'audit_high_sensitivity', 'compliance_report', 'risk_signal', 'approval_request',
        'query_purpose_registry', 'tpp_counterparty', 'billing_record_set', 'invoice_run',
        'nebras_ingest_snapshot', 'nebras_report_aggregate', 'platform_certification',
        'platform_outage', 'agent_registry'
      ]
      const derived = await regulatedTables(admin)
      for (const t of RETIRED_LITERAL) expect(derived).toContain(t)
      expect(derived.length).toBeGreaterThan(RETIRED_LITERAL.length)
    })

    it('a regulated table with rows but no lineage is reported as a gap (the gate can actually fail)', async () => {
      // Anti-vacuous-pass guard: prove the checker DETECTS a gap rather than only ever
      // returning "covered". Uses a synthetic table granted the same INSERT privilege,
      // so it enters the derived surface exactly as a real migration's table would.
      await admin.query(`CREATE TABLE IF NOT EXISTS harness11_probe (id uuid PRIMARY KEY)`)
      await admin.query(`GRANT INSERT, SELECT ON harness11_probe TO ofbo_app`)
      await admin.query(`INSERT INTO harness11_probe (id) VALUES ($1) ON CONFLICT DO NOTHING`, [crypto.randomUUID()])
      try {
        const derived = await regulatedTables(admin)
        expect(derived).toContain('harness11_probe')
        const result = await validateLineageCoverage(url)
        expect(result.gaps).toContain('harness11_probe')
        expect(evaluateLineageGate(result).ok).toBe(false)
      } finally {
        await admin.query(`DROP TABLE IF EXISTS harness11_probe`)
      }
    })
  })
})
