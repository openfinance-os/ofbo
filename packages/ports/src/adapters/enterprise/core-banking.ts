import type { Money } from '../../types.js'
import type { CoreBankingPort } from '../../interfaces.js'

/**
 * P4 — Core banking enterprise adapter (pre-staged per ADR 0024, fidelity rung ③).
 *
 * Read-only reconciliation inputs (balances + transactions). Core banking systems have no
 * single cross-vendor wire standard (Temenos, Finacle, Mambu, custom all differ), so the
 * adapter speaks a CANONICAL REST shape and the bank's integration layer maps its core's
 * payload to that shape in configuration (ADR 0024 guardrail 3 — "the bank's mapping lives
 * in configuration"). The adapter is read-only by construction — it never initiates money
 * movement.
 *
 * Implements EXACTLY the P4 port contract (`getBalance`, `getTransactions`) — nothing more.
 * Transport is injectable; no silent fake under the enterprise profile (fail-closed) — tests inject a fake transport, exercising
 * the real call→parse path with no
 * backend (guardrail 4 / rung ②). Money is enforced as integer minor units on the way out.
 */

export interface CoreBankingConfig {
  /** Bank Profile — core-banking REST base URL. Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
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

/** Money MUST be integer minor units (binding convention) — reject a core payload that
 *  hands us a float, never silently round it. */
function asMoney(amount: unknown, currency: unknown, what: string): Money {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) throw new CoreBankingError(0, false, `${what}: amount must be integer minor units, got ${String(amount)}`)
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new CoreBankingError(0, false, `${what}: currency must be ISO 4217, got ${String(currency)}`)
  return { amount, currency }
}

export function createCoreBankingAdapter(config: CoreBankingConfig = {}): CoreBankingPort {
  // FAIL-CLOSED: no silent fake under the enterprise profile — base URL + token are mandatory.
  if (!config.baseUrl) throw new CoreBankingError(0, false, 'core-banking baseUrl is required (fail-closed)')
  if (!config.getToken) throw new CoreBankingError(0, false, 'core-banking getToken is required')
  const getToken = config.getToken
  const base = config.baseUrl
  const doFetch = config.fetchImpl ?? globalThis.fetch

  async function call(path: string, trace: { trace_id: string }): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-fapi-interaction-id': trace.trace_id,
      authorization: `Bearer ${await getToken(trace)}`
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
  if (!env.CORE_BANKING_URL || !token) {
    throw new CoreBankingError(0, false, 'core-banking adapter misconfigured: set CORE_BANKING_URL and CORE_BANKING_TOKEN')
  }
  return createCoreBankingAdapter({ baseUrl: env.CORE_BANKING_URL, getToken: async () => token })
}
