import type { Context } from 'hono'
import { describe, expect, it } from 'vitest'
import { scopeDenied, domainError } from '../src/errors.js'
import { ScopeDeniedError } from '../src/rbac.js'

/** Minimal Context stand-in: records what was passed to c.json and echoes it back. */
function fakeContext() {
  const calls: { body: unknown; status?: number }[] = []
  const c = { json: (body: unknown, status?: number) => ((calls.push({ body, status }), { body, status })) }
  return { c: c as unknown as Context, calls }
}

describe('errors — shared route error classifier', () => {
  it('scopeDenied maps a ScopeDeniedError to the binding 403 envelope (carrying required_scope)', () => {
    const { c, calls } = fakeContext()
    const res = scopeDenied(c, new ScopeDeniedError('consents:admin', 'care-agent'))
    expect(res).not.toBeNull()
    expect(calls[0]!.status).toBe(403)
    const body = calls[0]!.body as { error: { code: string; required_scope: string } }
    expect(body.error.code).toBe('BACKOFFICE.SCOPE_DENIED')
    expect(body.error.required_scope).toBe('consents:admin')
  })

  it('scopeDenied returns null for a non-scope error so the caller falls through', () => {
    const { c, calls } = fakeContext()
    expect(scopeDenied(c, new Error('boom'))).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('domainError renders the binding error envelope with the error code/message/status and remediation', () => {
    const { c, calls } = fakeContext()
    domainError(c, { code: 'BACKOFFICE.NOPE', message: 'not allowed', status: 422 }, 'do this instead')
    expect(calls[0]!.status).toBe(422)
    const body = calls[0]!.body as { error: { code: string; message: string; remediation: string; docs_url: string } }
    expect(body.error).toMatchObject({ code: 'BACKOFFICE.NOPE', message: 'not allowed', remediation: 'do this instead' })
    expect(body.error.docs_url).toContain('backoffice-openapi')
  })
})
