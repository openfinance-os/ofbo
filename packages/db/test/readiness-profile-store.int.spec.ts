import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'
import { PgReadinessProfileStore } from '../src/readiness-profile-store.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')
const admin = new pg.Pool({ connectionString: url })
const tenancy = { bankId: '11111111-1111-4111-8111-111111111111', channel: 'internal_retail' }

describe('PgReadinessProfileStore (ADR 0022)', () => {
  const store = new PgReadinessProfileStore(url, tenancy)

  beforeAll(async () => {
    await applyMigrations(url)
  })
  afterAll(async () => {
    await admin.end()
  })

  it('persists a profile under an unguessable slug and reopens it', async () => {
    const input = { ports: { P2: 'okta', P6: 'kong' }, decisions: { 'BD-12': 'group' } }
    const saved = await store.create('Bank A pilot', input)
    expect(saved.slug).toMatch(/^rdy-/)
    expect(saved.name).toBe('Bank A pilot')

    const got = await store.get(saved.slug)
    expect(got).not.toBeNull()
    expect(got!.input).toEqual(input)
    expect(got!.created_at).toBe(saved.created_at)
  })

  it('returns null for an unknown slug', async () => {
    expect(await store.get('rdy-nope')).toBeNull()
  })

  it('carries no tenancy or PII columns, but IS governance-enrolled (classification)', async () => {
    const cols = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'readiness_profile'`
    )
    const names = cols.rows.map((r) => r.column_name).sort()
    expect(names).toEqual(['classification', 'created_at', 'input', 'name', 'slug'])
    expect(names).not.toContain('bank_id') // non-tenanted
  })

  it('is enrolled in retention + classification registries like every writable table', async () => {
    const ret = await admin.query<{ hot_months: number; immutable_months: number; deletion_allowed: boolean }>(
      `SELECT hot_months, immutable_months, deletion_allowed FROM retention_policy WHERE table_name = 'readiness_profile'`
    )
    expect(ret.rows[0]).toMatchObject({ hot_months: 24, immutable_months: 60, deletion_allowed: false })
    const cls = await admin.query<{ floor: string }>(
      `SELECT floor FROM classification_policy WHERE table_name = 'readiness_profile'`
    )
    expect(cls.rows[0]!.floor).toBe('internal-confidential')
  })

  it('has RLS enabled + forced even though its policy is public', async () => {
    const r = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'readiness_profile'`
    )
    expect(r.rows[0]!.relrowsecurity).toBe(true)
    expect(r.rows[0]!.relforcerowsecurity).toBe(true)
  })
})
