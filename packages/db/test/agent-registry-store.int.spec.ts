import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { applyMigrations } from '../src/apply.js'
import { PgAgentStore, type StoredAgent } from '../src/agent-registry-store.js'
import { PgLineageEmitter, validateLineageCoverage, type LineageEvent } from '../src/lineage.js'

/**
 * BACKOFFICE-60 — agent_registry durability + BCBS 239 lineage. Proves the Pg store
 * holds state across instances (isolate-restart shaped) under RLS tenancy, that revoke
 * is an in-place status flip, and that every write emits agent_registry lineage so the
 * Q4.5 gate finds real coverage. No PSU PII — service-account metadata only.
 */
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const TENANCY = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

const agent = (overrides: Partial<StoredAgent> = {}): StoredAgent => ({
  agent_id: randomUUID(),
  client_id: `agent-${randomUUID()}`,
  display_name: 'Reconciliation Read-only Bot',
  persona: 'reconciliation-readonly-agent',
  derived_from: 'finance-analyst',
  scopes: ['reconciliation:read', 'billing:read'],
  status: 'active',
  allow_mutations: false,
  spend_budget: 0,
  registered_by: 'demo:platform-admin',
  approved_by: 'demo:platform-super-admin',
  created_at: new Date().toISOString(),
  revoked_at: null,
  revoke_reason: null,
  ...overrides
})

beforeAll(async () => {
  await applyMigrations(DATABASE_URL)
})

describe('PgAgentStore (agent_registry table)', () => {
  const realLineage = new PgLineageEmitter(DATABASE_URL, TENANCY)
  const seen: LineageEvent[] = []
  const lineage = {
    emitLineage: async (e: LineageEvent) => {
      seen.push(e)
      await realLineage.emitLineage(e)
    }
  }
  afterAll(async () => {
    await realLineage.close()
  })

  it('persists a registered agent ACROSS store instances (isolate-restart shaped)', async () => {
    const a = agent()
    const writer = new PgAgentStore(DATABASE_URL, TENANCY, lineage)
    await writer.create(a, 'trace-create')
    await writer.close()

    const reader = new PgAgentStore(DATABASE_URL, TENANCY)
    const got = await reader.get(a.agent_id)
    await reader.close()
    expect(got).not.toBeNull()
    expect(got!.client_id).toBe(a.client_id)
    expect(got!.persona).toBe('reconciliation-readonly-agent')
    expect(got!.derived_from).toBe('finance-analyst')
    expect(got!.scopes).toEqual(['reconciliation:read', 'billing:read'])
    expect(got!.status).toBe('active')
    expect(got!.allow_mutations).toBe(false)
    expect(got!.spend_budget).toBe(0)
    expect(got!.approved_by).toBe('demo:platform-super-admin')
  })

  it('revokes in place (status flip) and lists the agent', async () => {
    const a = agent()
    const store = new PgAgentStore(DATABASE_URL, TENANCY, lineage)
    await store.create(a, 'trace-create-2')
    const revoked = await store.update(a.agent_id, { status: 'revoked', revoked_at: new Date().toISOString(), revoke_reason: 'rotating the credential now' }, 'trace-revoke')
    expect(revoked!.status).toBe('revoked')
    expect(revoked!.revoke_reason).toBe('rotating the credential now')

    const page = await store.list({ limit: 200 })
    await store.close()
    expect(page.rows.some((r) => r.agent_id === a.agent_id)).toBe(true)
  })

  it('emits agent_registry lineage so the Q4.5 gate finds coverage', async () => {
    expect(seen.some((e) => e.table === 'agent_registry')).toBe(true)
    const result = await validateLineageCoverage(DATABASE_URL)
    expect(result.gaps).not.toContain('agent_registry')
    expect(result.covered).toContain('agent_registry')
  })
})
