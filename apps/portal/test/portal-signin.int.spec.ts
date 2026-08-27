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

/**
 * A FRESH trace id per run. The audit trail is INSERT-only with no deletion path, and the
 * integration database is shared across suites and reruns — a fixed id accumulates a row every
 * time and the count assertions below start failing on the second run for no real reason.
 */
const TRACE = crypto.randomUUID()
const FAILURE_TRACE = crypto.randomUUID()

beforeAll(async () => {
  await applyMigrations(DATABASE_URL!)
  process.env.DEPLOY_PROFILE = 'demo'
}, 60_000)

afterAll(async () => {
  await admin.end()
})

describe('portal sign-in against a real audit trail', () => {
  /**
   * PRD §9 BACKOFFICE-47 — "failures audited". The portal wrote only successes, so the trail
   * recorded who got in and never who was turned away: the event a regulator asks about after the
   * fact, and the one an attacker generates in volume.
   */
  it('writes a signin_failure row for a rejected credential', async () => {
    const trace = FAILURE_TRACE
    const res = await login(new Request('https://portal.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': trace },
      body: new URLSearchParams({ token: 'not-a-real-token' })
    }) as never)

    expect(res.headers.get('location')).toMatch(/\/\?error=invalid_token$/)
    expect(res.headers.get('set-cookie') ?? '').not.toContain('demo-token')

    // `reason` is carried inside request_body_redacted, which is where PgAuditEmitter puts it.
    const row = await admin.query(
      `SELECT event_type, request_body_redacted, response_status, acting_persona FROM audit_high_sensitivity
        WHERE request_trace_id = $1 AND event_type = 'signin_failure'`,
      [trace]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].request_body_redacted.reason).toBe('invalid_token')
    // The status the BROWSER received, which is the 303 asserted above — not the 401 the emitter
    // infers from `signin_failure` for the BFF, whose `deny()` genuinely returns one. The spec
    // defines `response_status` as "the HTTP status returned to the caller", and this trail is
    // INSERT-only: a status no caller received cannot be corrected later.
    expect(res.status).toBe(303)
    expect(row.rows[0].response_status).toBe(303)
    // `invalid_token` establishes no persona, so there is none to record — the placeholder here
    // is the absence of a fact, not a lost one.
    expect(row.rows[0].acting_persona).toBe('unknown')
  }, 60_000)

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
      `SELECT event_type, acting_persona, response_status FROM audit_high_sensitivity
        WHERE request_trace_id = $1 AND event_type = 'signin_success'`,
      [TRACE]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].acting_persona).toBe('operations-analyst')
    // Same rule on the success path: a sign-in is a 303 to /dashboard, never the 200 the event
    // type would otherwise imply.
    expect(row.rows[0].response_status).toBe(303)
  }, 60_000)
})
