import type { Money } from '../../types.js'
import type { CoreBankingPort } from '../../interfaces.js'

/**
 * P4 — Core banking enterprise adapter (pre-staged per ADR 0023, fidelity rung ③).
 *
 * Read-only reconciliation inputs (balances + transactions). Core banking systems have no
 * single cross-vendor wire standard (Temenos, Finacle, Mambu, custom all differ), so the
 * adapter speaks a CANONICAL REST shape and the bank's integration layer maps its core's
 * payload to that shape in configuration (ADR 0023 guardrail 3 — "the bank's mapping lives
 * in configuration"). The adapter is read-only by construction — it never initiates money
 * movement.
 *
 * Implements EXACTLY the P4 port contract (`getBalance`, `getTransactions`) — nothing more.
 * Transport is injectable; with no base URL configured it binds an in-memory fake core with
 * deterministic balances/transactions, so the contract runs the real call→parse path with no
 * backend (guardrail 4 / rung ②). Money is enforced as integer minor units on the way out.
 */

export interface CoreBankingConfig {
  /** Bank Profile — core-banking REST base URL. When unset, the in-memory fake is used. */
  baseUrl?: string
  /** Bank Profile — bearer provider (service-to-service). Required once baseUrl is set. */
  getToken?: (trace: { trace_id: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export class CoreBankingError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'CoreBankingError'
  }
}

const FAKE_BASE = 'https://fake.core-banking.invalid'

const fakeCoreFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (/\/balance$/.test(url)) return json({ amount: 1_500_000, currency: 'AED', as_of: '2026-06-26T00:00:00.000Z' })
  if (/\/transactions/.test(url)) {
    return json([
      { ref: 'tx-000001', amount: -25_000, currency: 'AED', booked_at: '2026-06-01T08:00:00.000Z' },
      { ref: 'tx-000002', amount: 150_000, currency: 'AED', booked_at: '2026-06-02T09:30:00.000Z' }
    ])
  }
  return new Response(JSON.stringify({ error: 'unhandled' }), { status: 404 })
}

/** Money MUST be integer minor units (binding convention) — reject a core payload that
 *  hands us a float, never silently round it. */
function asMoney(amount: unknown, currency: unknown, what: string): Money {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) throw new CoreBankingError(0, false, `${what}: amount must be integer minor units, got ${String(amount)}`)
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new CoreBankingError(0, false, `${what}: currency must be ISO 4217, got ${String(currency)}`)
  return { amount, currency }
}

export function createCoreBankingAdapter(config: CoreBankingConfig = {}): CoreBankingPort {
  const real = Boolean(config.baseUrl)
  const base = config.baseUrl ?? FAKE_BASE
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeCoreFetch)

  async function call(path: string, trace: { trace_id: string }): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', 'x-fapi-interaction-id': trace.trace_id }
    if (real) {
      if (!config.getToken) throw new CoreBankingError(0, false, 'core-banking getToken is required when baseUrl is set')
      headers.authorization = `Bearer ${await config.getToken(trace)}`
    }
    const res = await doFetch(`${base}${path}`, { headers })
    if (!res.ok) throw new CoreBankingError(res.status, res.status === 429 || res.status >= 500, `core-banking ${path} → ${res.status}`)
    return res
  }

  return {
    async getBalance(accountRef, trace) {
      const res = await call(`/accounts/${encodeURIComponent(accountRef)}/balance`, trace)
      const b = (await res.json()) as { amount?: unknown; currency?: unknown; as_of?: string }
      return { balance: asMoney(b.amount, b.currency, 'getBalance'), as_of: b.as_of ?? new Date(Date.now()).toISOString() }
    },
    async getTransactions(accountRef, window, trace) {
      const res = await call(`/accounts/${encodeURIComponent(accountRef)}/transactions?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, trace)
      const rows = (await res.json()) as { ref?: string; amount?: unknown; currency?: unknown; booked_at?: string }[]
      return rows.map((r, i) => ({ ref: r.ref ?? `tx-${i}`, amount: asMoney(r.amount, r.currency, 'getTransactions'), booked_at: r.booked_at ?? '' }))
    }
  }
}

export function coreBankingFromEnv(env: NodeJS.ProcessEnv = process.env): CoreBankingPort {
  const token = env.CORE_BANKING_TOKEN
  return createCoreBankingAdapter({ baseUrl: env.CORE_BANKING_URL, getToken: token ? async () => token : undefined })
}
