import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { applyMigrations } from '@ofbo/db'
import { POST as login } from '../src/app/api/login/route.js'
import { TOKEN_COOKIE } from '../src/lib/cookies.js'

/**
 * BACKOFFICE-84 — the sign-in HAPPY path, which now requires a database.
 *
 * It used to live in the unit suite with `DATABASE_URL` deleted, which is exactly the arrangement
 * that hid the defect: a sign-in with no audit sink returned a session, and the test asserting the
 * session came back was satisfied by it. Auditing every sign-in means a session cannot be minted
 * without a real write, so proving one CAN be minted needs a real database.
 *
 * Asserts both halves together — the cookie AND the row — because the whole point is that neither
 * happens without the other.
 */
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('integration tests require DATABASE_URL')

const admin = new pg.Pool({ connectionString: DATABASE_URL })
const TRACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

beforeAll(async () => {
  await applyMigrations(DATABASE_URL!)
  process.env.DEPLOY_PROFILE = 'demo'
}, 60_000)

afterAll(async () => {
  await admin.end()
})

describe('portal sign-in against a real audit trail', () => {
  it('mints the session AND writes the High-class audit row', async () => {
    const res = await login(new Request('https://portal.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': TRACE },
      body: new URLSearchParams({ token: 'demo-token:operations-analyst' })
    }) as never)

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/dashboard$/)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${TOKEN_COOKIE}=demo-token%3Aoperations-analyst`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)

    // The row the session is not allowed to exist without.
    const row = await admin.query(
      `SELECT event_type, acting_persona FROM audit_high_sensitivity
        WHERE request_trace_id = $1 AND event_type = 'signin_success'`,
      [TRACE]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].acting_persona).toBe('operations-analyst')
  }, 60_000)
})
