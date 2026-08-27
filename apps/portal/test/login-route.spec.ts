import { describe, expect, it, beforeAll } from 'vitest'
import { POST as login, handleSignIn } from '../src/app/api/login/route.js'
import { POST as logout } from '../src/app/api/logout/route.js'
import { TOKEN_COOKIE } from '../src/lib/cookies.js'

/**
 * Route handlers exercised with the real demo (sim) IdP adapter and no DB
 * (audit emission is a no-op without DATABASE_URL). MFA sign-in → cookie set;
 * a bad token → bounce to the sign-in screen with the reason; no partial
 * session is ever issued.
 */

beforeAll(() => {
  process.env.DEPLOY_PROFILE = 'demo'
  delete process.env.DATABASE_URL
})

/** A real UUID, because that is what the header is documented to carry and what the route now
 *  requires before it will propagate one — `trace-login-1` was never a valid trace id. */
const TRACE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function loginRequest(token: string): Request {
  const body = new URLSearchParams({ token })
  return new Request('https://portal.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': TRACE },
    body
  })
}

describe('POST /api/login', () => {
  it('signs a valid persona in: 303 to /dashboard with an httpOnly session cookie', async () => {
    const res = await login(loginRequest('demo-token:operations-analyst') as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/dashboard$/)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${TOKEN_COOKIE}=demo-token%3Aoperations-analyst`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)
  })

  it('rejects an unknown token: 303 back to sign-in with the reason, no cookie', async () => {
    const res = await login(loginRequest('not-a-real-token') as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/\?error=invalid_token$/)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toContain('demo-token')
    // The trace id rides the failure too — it is what correlates this screen with the server log
    // line naming the cause, so the response carrying the error is the one that most needs it.
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)
  })
})

/**
 * BACKOFFICE-84 — a failing audit write must not be reported as a bad token.
 *
 * Sign-in is audited before the session is issued, and failing CLOSED when that write fails is
 * correct: an unaudited session is worse than a refused one. What was wrong is what the operator
 * was told. The handler caught every exception and redirected to `?error=invalid_token`, so a
 * database outage arrived on screen as "your token is invalid" — and on the hosted demo it did
 * exactly that, for every persona, for minutes at a time, while the BFF was healthy and accepting
 * the very same token.
 *
 * The distinction is not cosmetic. `invalid_token` sends whoever is diagnosing it to the IdP and
 * the token; the actual fault was an exhausted connection pool. These assert that an
 * infrastructure failure says so, and that a genuine auth failure still says what it always did.
 */
describe('POST /api/login — failure attribution', () => {
  it('reports an audit-write failure as a service failure, not a bad token', async () => {
    const res = await handleSignIn(loginRequest('demo-token:operations-analyst') as never, {
      auditSink: { record: async () => { throw new Error('connection refused') } }
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/\?error=service_unavailable$/)
    // Fails closed — no session may be issued when the sign-in could not be audited.
    expect(res.headers.get('set-cookie') ?? '').not.toContain('demo-token')
  })

  it('still reports a genuinely bad token as invalid_token', async () => {
    const res = await handleSignIn(loginRequest('not-a-real-token') as never, {
      auditSink: { record: async () => undefined }
    })
    expect(res.headers.get('location')).toMatch(/\/\?error=invalid_token$/)
  })
})

/**
 * BACKOFFICE-84 — the trace id is CLIENT-SUPPLIED, and it lands somewhere permanent.
 *
 * `x-fapi-interaction-id` arrives on the request, is echoed back on the response, and is written
 * to `audit_high_sensitivity` — which is INSERT-only with no deletion path for regulated records.
 * Unvalidated, that is an attacker-controlled string with a one-way trip into the regulated trail:
 * send a PSU identifier as the header and it is there for the five-year retention.
 *
 * The header is documented as a UUID v4 ("Send a UUID v4 in the x-fapi-interaction-id header" —
 * the BFF's own 400 remediation), so anything else is not a trace id and is replaced with one.
 * Rejecting the request would be the other option and is worse: it hands a caller a way to break
 * sign-in with a malformed header.
 */
describe('POST /api/login — the trace id is validated before it is trusted', () => {
  function requestWithTrace(trace: string): Request {
    return new Request('https://portal.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': trace },
      body: new URLSearchParams({ token: 'demo-token:operations-analyst' })
    })
  }

  it('does not echo or record a non-UUID trace id', async () => {
    const psu = '999-1990-1234567-1'
    const res = await login(requestWithTrace(psu) as never)
    const echoed = res.headers.get('x-fapi-interaction-id') ?? ''
    expect(echoed).not.toContain(psu)
    // Replaced with a real one rather than dropped — the response still correlates to a log line.
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('passes a well-formed UUID through untouched', async () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    const res = await login(requestWithTrace(uuid) as never)
    expect(res.headers.get('x-fapi-interaction-id')).toBe(uuid)
  })
})

describe('POST /api/logout', () => {
  it('clears the session cookie and returns to sign-in', async () => {
    const req = new Request('https://portal.example/api/logout', { method: 'POST' })
    const res = await logout(req as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/portal\.example\/$/)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${TOKEN_COOKIE}=`)
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/)
  })
})
