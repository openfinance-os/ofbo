import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '@ofbo/db'
import { POST as login } from '../src/app/api/login/route.js'

/**
 * BACKOFFICE-84 / BACKOFFICE-102 — sign-in must neither leak a connection nor retain one.
 *
 * BACKOFFICE-84: `PgAuditEmitter`'s constructor creates a `pg.Pool`, and the portal's resolver
 * called it on every sign-in. Nothing closed them, so each request left a pool holding connections
 * open until they idled out, and under sustained traffic they accumulated until the pooler refused
 * new ones. On the hosted demo that presented as sign-in working, then failing for EVERY persona
 * for minutes, then recovering — 12/12 succeeding, then 0/12 failing, the failures returning in
 * ~550ms against ~1700ms for a success: a refused connection, not a slow query.
 *
 * BACKOFFICE-102: the fix for that kept ONE pool at module scope, which leaks nothing and is
 * nonetheless wrong for the runtime the portal is deployed on. A Cloudflare Worker may not use an
 * I/O object created in another request's context, and a pool's whole purpose is to hold sockets
 * open for the next caller — so the second sign-in an isolate served was refused
 * ("Cannot perform I/O on behalf of a different request"), and sign-in, which fails closed on an
 * audit write it cannot perform, answered `/?error=service_unavailable` on a healthy deployment.
 *
 * Both defects are lifetime defects in opposite directions, so this pins the lifetime from both
 * ends against a real server's connection count: build per request (nothing retained afterwards)
 * and close before returning (nothing accumulated). A unit test cannot see either — the module
 * lifetime is asserted in `portal-db-lifetime.spec.ts`; what needs a real database is the proof
 * that the connections actually go away.
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

/**
 * The count once the server has had a moment to retire backends whose client has gone.
 *
 * `pool.end()` returns when the sockets are closed; `pg_stat_activity` can still show the backend
 * for a beat afterwards. Polling down to the expected number tolerates that lag WITHOUT tolerating
 * a connection that is genuinely still held — a retained pool never drops, so it spends the whole
 * budget and reports the retention.
 */
async function settledBackendCount(target: number, tries = 20): Promise<number> {
  let n = await backendCount()
  for (let i = 0; i < tries && n > target; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    n = await backendCount()
  }
  return n
}

function loginRequest(token: string): Request {
  return new Request('https://portal.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': crypto.randomUUID() },
    body: new URLSearchParams({ token })
  })
}

describe('sign-in connection lifetime', () => {
  beforeAll(async () => {
    await applyMigrations(DATABASE_URL!)
    process.env.DEPLOY_PROFILE = 'demo'
  }, 60_000)

  afterAll(async () => {
    await admin.end()
  })

  it('holds no connection open between sign-ins, and accumulates none across them', async () => {
    // The state to return to: what this database had open before the portal touched it.
    const idle = await backendCount()

    const first = await login(loginRequest('demo-token:operations-analyst') as never)
    expect(first.status).toBe(303)
    expect(first.headers.get('location')).toMatch(/\/dashboard$/)

    // BACKOFFICE-102 — the connection the sign-in opened is gone once the response is built.
    // Anything still open here is an I/O object that outlived its request, which is precisely what
    // the next request in the same Worker isolate would be refused for touching.
    expect(await settledBackendCount(idle), 'a completed sign-in must leave no connection behind').toBe(idle)

    for (let i = 0; i < 25; i += 1) {
      const res = await login(loginRequest('demo-token:finance-analyst') as never)
      // Every one must SUCCEED. The production symptom was not a slow sign-in, it was a refused
      // one — so a run that quietly started 303-ing back to `/?error=` would be the bug itself.
      expect(res.headers.get('location'), `sign-in ${i + 2} must reach the dashboard`).toMatch(/\/dashboard$/)
    }

    // BACKOFFICE-84 — and 25 more sign-ins do not move that number either. A per-request client
    // that is never closed adds at least one backend per sign-in; this one returns each before it
    // answers.
    const afterLoad = await settledBackendCount(idle)
    expect(afterLoad, 'connections must not grow with request volume').toBe(idle)
  }, 120_000)
})
