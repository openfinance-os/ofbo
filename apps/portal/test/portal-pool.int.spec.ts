import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '@ofbo/db'
import { POST as login } from '../src/app/api/login/route.js'

/**
 * BACKOFFICE-84 — sign-in must not leak a connection pool per request.
 *
 * `PgAuditEmitter`'s constructor creates a `pg.Pool`, and the portal's resolver used to call it on
 * every sign-in. Nothing closed them, so each request left a pool holding connections open until
 * they idled out, and under sustained traffic they accumulated until the pooler refused new ones.
 *
 * On the hosted demo that presented as sign-in working, then failing for EVERY persona for
 * minutes, then recovering — and because the handler reported any failure as `invalid_token`, it
 * read as an auth problem. Measured 12/12 succeeding, then 0/12 failing, the failures returning in
 * ~550ms against ~1700ms for a success: a refused connection, not a slow query.
 *
 * A unit test cannot see this; the leak is only observable against a real server's connection
 * count. So this signs in repeatedly and asserts the backend count does not grow with the number
 * of requests.
 */
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const admin = new pg.Pool({ connectionString: DATABASE_URL })

/** Backends this database has open, excluding our own observer connection. */
async function backendCount(): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()`
  )
  return Number(r.rows[0]!.n)
}

function loginRequest(token: string): Request {
  return new Request('https://portal.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': crypto.randomUUID() },
    body: new URLSearchParams({ token })
  })
}

describe('sign-in connection pooling', () => {
  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
    process.env.DEPLOY_PROFILE = 'demo'
  }, 60_000)

  afterAll(async () => {
    await admin.end()
  })

  it('reuses one pool across many sign-ins instead of leaking one per request', async () => {
    // Warm up first: the first sign-in legitimately opens the pool. What must not grow is the
    // count AFTER that, as request volume rises.
    const first = await login(loginRequest('demo-token:operations-analyst') as never)
    expect(first.status).toBe(303)
    expect(first.headers.get('location')).toMatch(/\/dashboard$/)
    const afterWarmup = await backendCount()

    for (let i = 0; i < 25; i += 1) {
      const res = await login(loginRequest('demo-token:finance-analyst') as never)
      // Every one must SUCCEED. The production symptom was not a slow sign-in, it was a refused
      // one — so a run that quietly started 303-ing back to `/?error=` would be the bug itself.
      expect(res.headers.get('location'), `sign-in ${i + 2} must reach the dashboard`).toMatch(/\/dashboard$/)
    }

    const afterLoad = await backendCount()
    // A per-request pool would add at least one backend per sign-in; a shared pool adds at most
    // its own max size. The slack absorbs the pool growing to its default ceiling under load.
    expect(afterLoad - afterWarmup).toBeLessThanOrEqual(10)
    expect(afterLoad).toBeLessThan(25)
  }, 120_000)
})
