import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations } from '../src/apply.js'
import { PgApprovalStore, type StoredApprovalRecord } from '../src/approvals-store.js'
import { PgIdempotencyStore } from '../src/idempotency-store.js'
import { PgLineageEmitter, type LineageEvent } from '../src/lineage.js'

/**
 * M1-DEMO-DEPLOY (conformance fix): on Workers, two requests in one demo
 * walkthrough can land on different isolates — in-memory approval/idempotency
 * state silently violates the contract (approvals unretrievable, Idempotency-Key
 * replay window destroyed). These suites prove the Pg-backed stores hold state
 * ACROSS instances (each instance ≈ one isolate) under RLS tenancy.
 */

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const record = (overrides: Partial<StoredApprovalRecord> = {}): StoredApprovalRecord => ({
  approval_request_id: `apr-${randomUUID()}`,
  operation_type: 'consents.bulk_revoke',
  operation_payload: { psu_identifier: 'synthetic-psu-0001' },
  state: 'pending',
  initiator: 'demo:operations-analyst',
  approver_required_scope: 'care:revoke',
  approver: null,
  expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
  reject_reason: null,
  ...overrides
})

beforeAll(async () => {
  await applyMigrations(DATABASE_URL)
})

describe('PgApprovalStore (approval_request table)', () => {
  const lineageEvents: Array<{ table: string }> = []
  // Forward to BOTH an in-memory recorder (for the assertion below) and the real
  // PgLineageEmitter, so approval_request lineage actually lands in the catalogue
  // — proving BCBS 239 end to end and giving the Q4.5 gate real coverage to find.
  const realLineage = new PgLineageEmitter(DATABASE_URL, TENANCY)
  const lineage = {
    emitLineage: async (e: LineageEvent) => {
      lineageEvents.push(e)
      await realLineage.emitLineage(e)
    }
  }
  afterAll(async () => {
    await realLineage.close()
  })

  it('persists approvals ACROSS store instances (isolate-restart shaped)', async () => {
    const writer = new PgApprovalStore(DATABASE_URL, TENANCY, lineage)
    const r = record()
    await writer.create(r)
    await writer.close()

    const reader = new PgApprovalStore(DATABASE_URL, TENANCY)
    const got = await reader.get(r.approval_request_id)
    await reader.close()
    expect(got).not.toBeNull()
    expect(got!.operation_type).toBe('consents.bulk_revoke')
    expect(got!.state).toBe('pending')
    expect(got!.expires_at).toBe(r.expires_at)
  })

  it('updates state + execution_result and lists pending only', async () => {
    const store = new PgApprovalStore(DATABASE_URL, TENANCY, lineage)
    const a = record()
    const b = record()
    await store.create(a)
    await store.create(b)
    await store.update({ ...a, state: 'approved', approver: 'demo:compliance-officer', execution_result: { ok: true } })

    const second = new PgApprovalStore(DATABASE_URL, TENANCY)
    const gotA = await second.get(a.approval_request_id)
    expect(gotA!.state).toBe('approved')
    expect(gotA!.approver).toBe('demo:compliance-officer')
    expect(gotA!.execution_result).toEqual({ ok: true })

    const pending = await second.listPending()
    expect(pending.some((p) => p.approval_request_id === b.approval_request_id)).toBe(true)
    expect(pending.some((p) => p.approval_request_id === a.approval_request_id)).toBe(false)
    await store.close()
    await second.close()
  })

  it('emits lineage at write time (BCBS 239 — never retrofitted)', async () => {
    lineageEvents.length = 0
    const store = new PgApprovalStore(DATABASE_URL, TENANCY, lineage)
    const r = record()
    await store.create(r)
    await store.update({ ...r, state: 'rejected', approver: 'demo:compliance-officer', reject_reason: 'demo' })
    await store.close()
    expect(lineageEvents.filter((e) => e.table === 'approval_request').length).toBe(2)
  })

  it('is tenancy-scoped by RLS: another bank_id sees nothing', async () => {
    const store = new PgApprovalStore(DATABASE_URL, TENANCY)
    const r = record()
    await store.create(r)
    await store.close()

    const otherBank = new PgApprovalStore(DATABASE_URL, { ...TENANCY, bankId: randomUUID() })
    expect(await otherBank.get(r.approval_request_id)).toBeNull()
    await otherBank.close()
  })
})

describe('PgIdempotencyStore (idempotency_key table)', () => {
  it('replays cached responses ACROSS store instances within the 24h window', async () => {
    const key = `post /approvals|demo:operations-analyst|${randomUUID()}`
    const writer = new PgIdempotencyStore(DATABASE_URL, TENANCY)
    await writer.set(key, 201, { data: { approval_request_id: 'apr-1' } })
    await writer.close()

    const reader = new PgIdempotencyStore(DATABASE_URL, TENANCY)
    const cached = await reader.get(key)
    await reader.close()
    expect(cached).not.toBeNull()
    expect(cached!.status).toBe(201)
    expect(cached!.body).toEqual({ data: { approval_request_id: 'apr-1' } })
  })

  it('misses (and prunes) entries older than the 24h window', async () => {
    const key = `approve|demo:operations-analyst|${randomUUID()}`
    let clock = Date.now()
    const store = new PgIdempotencyStore(DATABASE_URL, TENANCY, () => clock)
    await store.set(key, 200, { data: 'old' })
    clock += 25 * 3600_000
    expect(await store.get(key)).toBeNull()
    await store.close()
  })

  it('first write wins on concurrent same-key writes (no duplicate side effects)', async () => {
    const key = `reject|demo:operations-analyst|${randomUUID()}`
    const store = new PgIdempotencyStore(DATABASE_URL, TENANCY)
    await store.set(key, 200, { data: 'first' })
    await store.set(key, 200, { data: 'second' })
    const cached = await store.get(key)
    expect(cached!.body).toEqual({ data: 'first' })
    await store.close()
  })

  it('is tenancy-scoped: another bank_id cannot replay the entry', async () => {
    const key = `post /approvals|demo:operations-analyst|${randomUUID()}`
    const store = new PgIdempotencyStore(DATABASE_URL, TENANCY)
    await store.set(key, 201, { data: 'x' })
    await store.close()

    const otherBank = new PgIdempotencyStore(DATABASE_URL, { ...TENANCY, bankId: randomUUID() })
    expect(await otherBank.get(key)).toBeNull()
    await otherBank.close()
  })
})
