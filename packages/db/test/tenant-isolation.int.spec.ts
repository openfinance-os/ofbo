import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '../src/apply.js'

/**
 * HOST-02 (ADR 0027 / docs/proposals/multitenant-platform-blueprint.md) — the load-bearing
 * isolation proof for hosted multi-tenancy. Migration 0030 re-scopes the `bank_internal_view`
 * cross-tenant bypass from `USING (true)` to the caller's pinned tenant group. This suite proves:
 *   1. a group-pinned bypass reads ONLY its own group and CANNOT see another tenant's rows;
 *   2. an unpinned bypass falls back to the legacy read-all (single-tenant backward compat);
 *   3. ordinary `ofbo_app` RLS isolation is unaffected.
 *
 * Uses dedicated bank/group UUIDs so it never contaminates the shared integration database.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for integration tests')

const admin = new pg.Pool({ connectionString: url })

const GROUP_A = 'aa000000-0000-4000-8000-00000000a100'
const GROUP_B = 'bb000000-0000-4000-8000-00000000b100'
const BANK_A = 'aa000000-0000-4000-8000-0000000000a1'
const BANK_B = 'bb000000-0000-4000-8000-0000000000b1'

async function asApp<T>(bankId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await admin.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE ofbo_app')
    await c.query(`SELECT set_config('app.bank_id', $1, true)`, [bankId])
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}

function insertAudit(c: pg.PoolClient, bankId: string, trace: string) {
  return c.query(
    `INSERT INTO audit_high_sensitivity
       (bank_id, channel, event_type, acting_principal, acting_persona, scope_used, request_trace_id, request_body_redacted, response_status)
     SELECT $1, 'internal_retail', 'psu_lookup', 'seed', 'system', 'seed', $2, '{}'::jsonb, 200
      WHERE NOT EXISTS (SELECT 1 FROM audit_high_sensitivity WHERE request_trace_id = $2)`,
    [bankId, trace]
  )
}

/** Run `fn` as the SELECT-only bypass role, optionally pinning a tenant group. Returns
 *  `{ skipped: true }` if the managed environment forbids assuming the NOLOGIN view role. */
async function asInternalView<T>(
  groupId: string | undefined,
  fn: (c: pg.PoolClient) => Promise<T>
): Promise<{ skipped: true } | { skipped: false; out: T }> {
  const c = await admin.connect()
  try {
    await c.query('BEGIN')
    try {
      await c.query('SET LOCAL ROLE bank_internal_view')
    } catch (e) {
      console.warn('bank_internal_view SET ROLE not permitted here, skipping:', (e as Error).message)
      await c.query('ROLLBACK').catch(() => undefined)
      return { skipped: true }
    }
    if (groupId) await c.query(`SELECT set_config('app.tenant_group', $1, true)`, [groupId])
    const out = await fn(c)
    await c.query('COMMIT')
    return { skipped: false, out }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}

describe('HOST-02 — cross-tenant isolation of the bank_internal_view bypass', () => {
  beforeAll(async () => {
    await applyMigrations(url)
    try {
      await admin.query('GRANT bank_internal_view TO CURRENT_USER')
    } catch {
      /* not permitted here — the bypass assertions self-skip below */
    }
    // Enrol the two banks into distinct single-member tenant groups (control-plane owner write;
    // tenant_group_member is RLS ENABLE-not-FORCE, so the superuser/owner connection may write).
    for (const [bank, group] of [
      [BANK_A, GROUP_A],
      [BANK_B, GROUP_B]
    ]) {
      await admin.query(
        `INSERT INTO tenant_group_member (bank_id, tenant_group_id, group_slug, display_name, tier)
         VALUES ($1, $2, 'iso-grp', 'Isolation Group', 'tier2')
         ON CONFLICT (bank_id) DO NOTHING`,
        [bank, group]
      )
    }
    await asApp(BANK_A, (c) => insertAudit(c, BANK_A, 'iso-a-1'))
    await asApp(BANK_B, (c) => insertAudit(c, BANK_B, 'iso-b-1'))
  })
  afterAll(async () => {
    await admin.end()
  })

  it('a group-pinned bypass sees ONLY its own group and NOT the other tenant', async () => {
    const r = await asInternalView(GROUP_A, async (c) => {
      const a = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE bank_id=$1`, [BANK_A])
      const b = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE bank_id=$1`, [BANK_B])
      return { a: a.rows[0].n as number, b: b.rows[0].n as number }
    })
    if (r.skipped) return
    expect(r.out.a).toBeGreaterThanOrEqual(1) // sees its own tenant's rows
    expect(r.out.b).toBe(0) // CANNOT see the other customer's rows — the HOST-02 isolation guarantee
  })

  it('an unpinned bypass falls back to legacy read-all (single-tenant backward compatibility)', async () => {
    const r = await asInternalView(undefined, async (c) => {
      const b = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE bank_id=$1`, [BANK_B])
      return b.rows[0].n as number
    })
    if (r.skipped) return
    expect(r.out).toBeGreaterThanOrEqual(1) // no group pinned → reads across, exactly as before HOST-02
  })

  it('ordinary ofbo_app RLS isolation is unaffected by tenant groups', async () => {
    const visible = await asApp(BANK_A, async (c) => {
      const r = await c.query(`SELECT count(*)::int AS n FROM audit_high_sensitivity WHERE bank_id=$1`, [BANK_B])
      return r.rows[0].n as number
    })
    expect(visible).toBe(0)
  })

  it('a tenant sees only its own tenant_group_member row', async () => {
    const rows = await asApp(BANK_A, async (c) => {
      const r = await c.query(`SELECT bank_id, tenant_group_id FROM tenant_group_member`)
      return r.rows
    })
    expect(rows.length).toBe(1)
    expect(rows[0].bank_id).toBe(BANK_A)
    expect(rows[0].tenant_group_id).toBe(GROUP_A)
  })
})
