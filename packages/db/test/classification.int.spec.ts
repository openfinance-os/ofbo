import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgAuditEmitter } from '../src/audit.js'
import { validateClassificationFloors } from '../src/classification.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const BANK = '11111111-1111-4111-8111-111111111111'
const TRACE = `class-int-${crypto.randomUUID()}` // unique per run

const ALL_TABLES = [
  'reconciliation_log',
  'reconciliation_break',
  'dispute_case',
  'audit_high_sensitivity',
  'compliance_report',
  'risk_signal',
  'approval_request',
  'query_purpose_registry',
  'tpp_counterparty',
  'lineage_events'
]

describe('BACKOFFICE-54 — data-classification metadata on every record', () => {
  const admin = new pg.Pool({ connectionString: url })
  let audit: PgAuditEmitter

  beforeAll(async () => {
    await applyMigrations(url)
    audit = new PgAuditEmitter(url, { bankId: BANK, channel: 'internal_retail' })
  })
  afterAll(async () => {
    await audit.close()
    await admin.end()
  })

  it('every Back Office table carries a NOT NULL classification column', async () => {
    const r = await admin.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'classification' ORDER BY table_name`
    )
    const byTable = new Map(r.rows.map((x) => [x.table_name, x.is_nullable]))
    for (const t of ALL_TABLES) {
      expect(byTable.has(t), t).toBe(true)
      expect(byTable.get(t), t).toBe('NO')
    }
  })

  it('audit records default to restricted — the highest class', async () => {
    await audit.record({
      event_type: 'signin_success',
      acting_principal: 'demo:operations-analyst',
      acting_persona: 'operations-analyst',
      reason: null,
      trace_id: TRACE
    })
    const r = await admin.query(
      `SELECT classification FROM audit_high_sensitivity WHERE request_trace_id = $1`,
      [TRACE]
    )
    expect(r.rows[0].classification).toBe('restricted')
  })

  it('rejects an out-of-vocabulary classification value', async () => {
    await expect(
      admin.query(
        `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, classification)
         VALUES ($1, 'internal_retail', 'agent_anomaly', 'info', 'open', '{}'::jsonb, 'top-secret')`,
        [BANK]
      )
    ).rejects.toThrow(/invalid input value|check|domain/)
  })

  it('a record classified below its table floor is a mismatch flagged for Compliance review', async () => {
    // risk_signal floor is confidential-restricted; plant one below it (admin write — app roles default correctly)
    await admin.query(
      `INSERT INTO risk_signal (bank_id, channel, signal_type, severity, status, signal_data, classification)
       VALUES ($1, 'internal_retail', 'agent_anomaly', 'info', 'open', $2::jsonb, 'internal-confidential')`,
      [BANK, JSON.stringify({ trace_id: TRACE })]
    )
    const result = await validateClassificationFloors(url)
    const flagged = result.mismatches.find((m) => m.table_name === 'risk_signal')
    expect(flagged).toBeDefined()
    expect(flagged!.below_floor_count).toBeGreaterThanOrEqual(1)
    expect(flagged!.floor).toBe('confidential-restricted')
  })

  it('correctly-classified tables report no mismatch', async () => {
    const result = await validateClassificationFloors(url)
    expect(result.mismatches.map((m) => m.table_name)).not.toContain('audit_high_sensitivity')
  })
})
