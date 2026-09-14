import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { recordSignIn, recordSignInFailure, recentAudit } from '../src/lib/portal.js'

/**
 * BACKOFFICE-102 — the portal runs on Cloudflare Workers, and a Worker may not reuse an I/O
 * object across requests.
 *
 * A `pg.Pool` IS an I/O object: it holds live sockets and hands an idle one back on the next
 * `connect()`. Held at module scope it survives the request that opened it, so the NEXT request
 * served by the same isolate queries over a socket created in someone else's request context and
 * the runtime refuses it — "Cannot perform I/O on behalf of a different request". Sign-in fails
 * closed on an audit write it cannot perform, so what the operator sees is
 * `/?error=service_unavailable` on a healthy deployment, for every persona, from the second
 * sign-in an isolate serves until that isolate recycles.
 *
 * The BFF worker already states the rule it lives by — "Pg clients are constructed per request and
 * closed after the response — Workers forbid reusing I/O objects across requests"
 * (services/bff/src/worker.ts). The portal is the same runtime and gets the same lifetime.
 *
 * So this asserts the LIFETIME directly, which is the only property that matters here: each unit
 * of work builds its own client and closes it before returning. A client retained between calls
 * fails the first assertion; a leaked one — the defect the module-scope pool was introduced to fix
 * — fails the second. Both halves have to hold at once, which is what neither the pool the portal
 * had nor the per-request pool before it managed.
 */

/** Every client the portal built, and whether it was handed back. Hoisted — `vi.mock`'s factory
 *  runs before the module body, so it cannot close over an ordinary top-level binding. */
const spy = vi.hoisted(() => ({
  built: [] as Array<{ kind: 'emitter' | 'reader'; closed: boolean }>,
  /** Set to make the next `record()` fail, the way a real write against a dead pooler does. */
  failNextRecord: null as Error | null,
  /** Set to make BUILDING the client fail, the way a malformed DATABASE_URL does. */
  failNextConstruct: null as Error | null
}))

vi.mock('@ofbo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ofbo/db')>()
  /** Records its own construction and close; performs no I/O — only the lifetime is under test. */
  class RecordingClient {
    private readonly me: { kind: 'emitter' | 'reader'; closed: boolean }
    constructor(kind: 'emitter' | 'reader') {
      const fail = spy.failNextConstruct
      if (fail) {
        spy.failNextConstruct = null
        throw fail
      }
      this.me = { kind, closed: false }
      spy.built.push(this.me)
    }
    async close(): Promise<void> {
      this.me.closed = true
    }
  }
  class RecordingEmitter extends RecordingClient {
    constructor(_url: string, _config: unknown) {
      super('emitter')
    }
    async record(): Promise<void> {
      const fail = spy.failNextRecord
      if (fail) {
        spy.failNextRecord = null
        throw fail
      }
    }
  }
  class RecordingReader extends RecordingClient {
    constructor(_url: string, _config: unknown) {
      super('reader')
    }
    async recent(): Promise<unknown[]> {
      return []
    }
  }
  return { ...actual, PgAuditEmitter: RecordingEmitter, PgAuditReader: RecordingReader }
})

/** Scopes are what the §2 matrix grants this persona, nothing more — inert on every path here,
 *  but a fixture that grants beyond the matrix is the precedent the next reader copies. */
const PRINCIPAL = {
  subject: 'ops-analyst-01',
  persona: 'operations-analyst',
  scopes: ['platform:operations:read', 'platform:operations:write', 'certification:read'],
  superadmin: false
}
const TRACE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

/** Never connected to — the client is a recording double. */
const URL_A = 'postgres://ofbo@db.invalid:5432/ofbo'
const URL_B = 'postgres://ofbo@other.invalid:5432/ofbo'
const previousUrl = process.env.DATABASE_URL

beforeAll(() => {
  process.env.DEPLOY_PROFILE = 'demo'
})

beforeEach(() => {
  spy.built.length = 0
  spy.failNextRecord = null
  spy.failNextConstruct = null
  process.env.DATABASE_URL = URL_A
})

afterAll(() => {
  if (previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousUrl
})

/** No client outlives the work it was built for, and none is left open behind it. */
function expectPerRequestLifetime(expected: number): void {
  expect(spy.built.length, 'one client per unit of work — never one retained across requests').toBe(expected)
  expect(
    spy.built.filter((c) => !c.closed),
    'every client built must be closed before the work returns'
  ).toEqual([])
}

describe('portal audit clients — per-request lifetime (Workers forbid reuse across requests)', () => {
  it('builds and closes one client per sign-in', async () => {
    await expect(recordSignIn(PRINCIPAL, TRACE)).resolves.toBe(true)
    expectPerRequestLifetime(1)

    // The second sign-in is the one the module-scope pool broke: it must reach a client of its
    // own rather than the socket the first sign-in opened.
    await expect(recordSignIn(PRINCIPAL, TRACE)).resolves.toBe(true)
    expectPerRequestLifetime(2)
  })

  it('builds and closes one client per audited sign-in failure', async () => {
    await recordSignInFailure('invalid_token', TRACE, null)
    await recordSignInFailure('mfa_not_satisfied', TRACE, 'operations-analyst')
    expectPerRequestLifetime(2)
  })

  it('builds and closes one client per audit read', async () => {
    await recentAudit(PRINCIPAL)
    await recentAudit(PRINCIPAL)
    expectPerRequestLifetime(2)
    expect(spy.built.every((c) => c.kind === 'reader')).toBe(true)
  })

  it('closes the client even when the audit write fails', async () => {
    spy.failNextRecord = new Error('connection terminated unexpectedly')
    // A failed write still fails the sign-in — it must not ALSO strand the connection.
    await expect(recordSignIn(PRINCIPAL, TRACE)).rejects.toThrow('connection terminated unexpectedly')
    expectPerRequestLifetime(1)
  })

  /**
   * Building the client is I/O configuration and can fail on its own — and per-request
   * construction means it is attempted on every refusal rather than once per process.
   *
   * The two callers must answer that differently, which is the whole point of auditing the two
   * outcomes differently. A sign-in that cannot be recorded is refused; a REFUSAL that cannot be
   * recorded is reported and swallowed, because `recordSignInFailure` runs inside the route's own
   * catch — anything it throws escapes the handler and turns the 303 back to the sign-in screen
   * into an unhandled 500, losing the very explanation the operator needs.
   */
  it('refuses the sign-in, but not the refusal, when the audit client cannot be built', async () => {
    spy.failNextConstruct = new Error('invalid connection string')
    await expect(recordSignIn(PRINCIPAL, TRACE)).rejects.toThrow('invalid connection string')

    spy.failNextConstruct = new Error('invalid connection string')
    await expect(recordSignInFailure('invalid_token', TRACE, null)).resolves.toBeUndefined()

    expect(spy.built, 'a client that failed to build is not one to close').toEqual([])
  })

  it('opens no client at all when no database is configured', async () => {
    delete process.env.DATABASE_URL
    await expect(recordSignIn(PRINCIPAL, TRACE)).resolves.toBe(false)
    expect(spy.built).toEqual([])
  })

  it('follows a changed DATABASE_URL without carrying the previous client over', async () => {
    await recordSignIn(PRINCIPAL, TRACE)
    process.env.DATABASE_URL = URL_B
    await recordSignIn(PRINCIPAL, TRACE)
    expectPerRequestLifetime(2)
  })

  it('never closes a sink the caller injected — that client is the caller to close', async () => {
    const injected = { record: vi.fn(async () => {}), close: vi.fn(async () => {}) }
    await expect(recordSignIn(PRINCIPAL, TRACE, { auditSink: injected })).resolves.toBe(true)
    expect(injected.record).toHaveBeenCalledOnce()
    expect(injected.close).not.toHaveBeenCalled()
    expect(spy.built).toEqual([])
  })
})
