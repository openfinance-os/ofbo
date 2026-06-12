import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { PgLineageEmitter, validateLineageCoverage } from '../src/lineage.js'

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

  it('validateLineageCoverage (the Q4.5 check) confirms written tables have lineage and names gaps', async () => {
    const result = await validateLineageCoverage(url)
    expect(result.covered).toContain('audit_high_sensitivity')
    // tpp_counterparty was seeded by the M0 seed without lineage — a genuine pre-existing
    // gap the Q4.5 check MUST name (regression pin per review)
    expect(result.gaps).toContain('tpp_counterparty')
  })
})
