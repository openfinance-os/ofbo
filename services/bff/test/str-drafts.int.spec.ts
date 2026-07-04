import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { applyMigrations, PgAuditEmitter, PgLineageEmitter, PgStrDraftStore } from '@ofbo/db'
import { createApp } from '../src/app.js'

/**
 * BACKOFFICE-63 — str_draft persistence + audit + lineage over real Postgres (RLS via
 * ofbo_app), through the full four-eyes handoff (Compliance initiates → Risk approves → P10).
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const compliance = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:compliance-officer',
  'content-type': 'application/json',
  ...extra
})
const risk = (extra: Record<string, string>) => ({
  authorization: 'Bearer demo-token:risk-analyst',
  'content-type': 'application/json',
  ...extra
})

describe('STR draft — persistence + four-eyes handoff + audit + lineage', () => {
  const admin = new pg.Pool({ connectionString: url! })
  const lineage = new PgLineageEmitter(url!, TENANCY)
  const audit = new PgAuditEmitter(url!, TENANCY, lineage)
  const strDraftStore = new PgStrDraftStore(url!, TENANCY, lineage)
  const app = createApp({ strDraftStore, audit })

  beforeAll(async () => {
    await applyMigrations(url!)
  }, 60_000)
  afterAll(async () => {
    await audit.close()
    await lineage.close()
    await strDraftStore.close()
    await admin.end()
  })

  it('persists a draft (row + lineage), then hands it off four-eyes (status + workflow_ref + audit)', async () => {
    const recTrace = randomUUID()
    // A real draft is raised by a fraud-revoke, so source_consent_id is the consent UUID.
    const consentId = randomUUID()
    const draft = await strDraftStore.record(
      { source_consent_id: consentId, case_context: 'velocity anomaly (synthetic)', created_by: 'demo:risk-analyst' },
      recTrace
    )

    // The row is persisted under RLS and lineage was emitted at write time.
    const row = await admin.query(`SELECT source_consent_id, status FROM str_draft WHERE id = $1`, [draft.str_draft_id])
    expect(row.rows[0]).toMatchObject({ status: 'draft' })
    const lin = await admin.query(`SELECT 1 FROM lineage_events WHERE trace_id = $1 AND table_name = 'str_draft'`, [recTrace])
    expect(lin.rows.length).toBeGreaterThan(0)

    // Compliance lists + reads it.
    const list = await app.request('/back-office/str-drafts', { headers: compliance({ 'x-fapi-interaction-id': randomUUID() }) })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { data: { str_draft_id: string }[] }).data.some((r) => r.str_draft_id === draft.str_draft_id)).toBe(true)

    // Compliance initiates the handoff (202); a Risk second-line approves; P10 records the ref.
    const submitTrace = randomUUID()
    const submit = await app.request(`/back-office/str-drafts/${draft.str_draft_id}:submit-to-workflow`, {
      method: 'POST',
      headers: compliance({ 'x-fapi-interaction-id': submitTrace, 'idempotency-key': randomUUID() })
    })
    expect(submit.status).toBe(202)
    const approvalId = ((await submit.json()) as { data: { approval_request_id: string } }).data.approval_request_id
    const awaiting = await admin.query(`SELECT status, approval_id FROM str_draft WHERE id = $1`, [draft.str_draft_id])
    expect(awaiting.rows[0].status).toBe('awaiting_handoff')

    const approve = await app.request(`/approvals/${approvalId}:approve`, {
      method: 'POST',
      headers: risk({ 'x-fapi-interaction-id': randomUUID(), 'idempotency-key': randomUUID() })
    })
    expect(approve.status).toBe(200)

    const handed = await admin.query(`SELECT status, workflow_ref, approved_by FROM str_draft WHERE id = $1`, [draft.str_draft_id])
    expect(handed.rows[0].status).toBe('handed_off')
    expect(handed.rows[0].workflow_ref).toMatch(/^str-wf-/) // P10 sim reference — never an AML GO id
    expect(handed.rows[0].approved_by).toBe('demo:risk-analyst')

    // The handoff is High-class audited under the submit trace (four-eyes approved).
    const remit = await admin.query(`SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $1 AND event_type = 'str_draft_handed_off'`, [submitTrace])
    expect(remit.rows).toHaveLength(1)
  }, 60_000)
})
