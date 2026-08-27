import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { POST as login } from '../src/app/api/login/route.js'
import { POST as logout } from '../src/app/api/logout/route.js'
import { TOKEN_COOKIE } from '../src/lib/cookies.js'
import { resetAuditPools } from '../src/lib/portal.js'

/**
 * Route handlers exercised through the REAL entry point, with the real demo (sim) IdP adapter and
 * no dependency-injection seam — `POST(req)` is the only way in, which is the point: a second way
 * into the sign-in path is a second auth path.
 *
 * The failure modes are therefore driven by CONFIGURATION rather than by substitution, which also
 * makes them the genuine article. No `DATABASE_URL` produces a genuinely absent audit sink; an
 * unreachable one produces a genuine audit-write failure.
 *
 * The happy path needs a real database — auditing every sign-in is what that costs — so it lives
 * in the integration suite, not here.
 */

beforeAll(() => {
  process.env.DEPLOY_PROFILE = 'demo'
  delete process.env.DATABASE_URL
})

afterEach(() => {
  resetAuditPools()
})

/** A real UUID — what the header is documented to carry, and what the route propagates. */
const TRACE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function loginRequest(token: string, trace = TRACE): Request {
  return new Request('https://portal.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': trace },
    body: new URLSearchParams({ token })
  })
}

describe('POST /api/login — authentication failures', () => {
  it('rejects an unknown token: 303 back to sign-in with the reason, no cookie', async () => {
    const res = await login(loginRequest('not-a-real-token') as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/\?error=invalid_token$/)
    expect(res.headers.get('set-cookie') ?? '').not.toContain('demo-token')
    // The trace id rides the failure too — it is what correlates this screen with the server log
    // line naming the cause, so the response carrying the error is the one that most needs it.
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)
  })
})

/**
 * BACKOFFICE-84 — no session without a regulated record.
 *
 * A failing audit WRITE already failed the sign-in. The remaining gap was an ABSENT sink: nothing
 * threw, `recordSignIn` returned quietly, and a privileged scope-bearing session was issued with no
 * row in the INSERT-only trail. CLAUDE.md does not qualify "audit-relevant operations emit to
 * audit_high_sensitivity" by WHY the sink is missing, so neither does the route — and an earlier
 * cut that let a deployment opt out with an environment flag was inventing an exemption the canon
 * does not grant.
 */
describe('POST /api/login — no session without an audit record', () => {
  it('refuses to sign in when no audit sink is configured', async () => {
    const res = await login(loginRequest('demo-token:operations-analyst') as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/\?error=service_unavailable$/)
    expect(res.headers.get('set-cookie') ?? '').not.toContain('demo-token')
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)
  })

  it('reports an unreachable database as a service failure, not a bad token', async () => {
    // A REAL audit-write failure, not a substituted one: the pool cannot reach this host, so
    // `recordSignIn` throws exactly as it did in the outage this story was opened for.
    process.env.DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/does-not-exist'
    try {
      const res = await login(loginRequest('demo-token:operations-analyst') as never)
      expect(res.headers.get('location')).toMatch(/\/\?error=service_unavailable$/)
      expect(res.headers.get('set-cookie') ?? '').not.toContain('demo-token')
    } finally {
      delete process.env.DATABASE_URL
    }
  }, 30_000)
})

/**
 * BACKOFFICE-84 — the trace id is CLIENT-SUPPLIED and lands somewhere permanent.
 *
 * It is echoed on the response and written to `audit_high_sensitivity`, which is INSERT-only with
 * no deletion path. Unvalidated, that is an attacker-controlled string with a one-way trip into
 * the regulated trail. Validated to the shape it is documented to have, and replaced when it is
 * not one — replaced rather than REJECTED, since refusing would hand any caller a way to break
 * sign-in with a malformed header.
 */
describe('POST /api/login — the trace id is validated before it is trusted', () => {
  it('does not echo a non-UUID trace id', async () => {
    // Deliberately NOT an identifier-shaped literal. This asserts "anything that is not a UUID is
    // replaced", which an arbitrary string proves exactly as well — CLAUDE.md's identifier-literal
    // exemption is worded for tests that assert a REDACTION control, and this asserts validation.
    const supplied = 'not-a-uuid-caller-controlled'
    const res = await login(loginRequest('demo-token:operations-analyst', supplied) as never)
    const echoed = res.headers.get('x-fapi-interaction-id') ?? ''
    expect(echoed).not.toContain(supplied)
    // Replaced with a real one rather than dropped — the response still correlates to a log line.
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('passes a well-formed UUID through untouched', async () => {
    const res = await login(loginRequest('demo-token:operations-analyst') as never)
    expect(res.headers.get('x-fapi-interaction-id')).toBe(TRACE)
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
