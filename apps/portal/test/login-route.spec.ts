import { describe, expect, it, beforeAll } from 'vitest'
import { POST as login } from '../src/app/api/login/route.js'
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

function loginRequest(token: string): Request {
  const body = new URLSearchParams({ token })
  return new Request('https://portal.example/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fapi-interaction-id': 'trace-login-1' },
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
    expect(res.headers.get('x-fapi-interaction-id')).toBe('trace-login-1')
  })

  it('rejects an unknown token: 303 back to sign-in with the reason, no cookie', async () => {
    const res = await login(loginRequest('not-a-real-token') as never)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/\?error=invalid_token$/)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toContain('demo-token')
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
