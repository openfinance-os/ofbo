import type { FinancialSystemPort } from '../../interfaces.js'

/**
 * P9 — Financial management system enterprise adapter (pre-staged per ADR 0023, rung ③).
 *
 * BOUNDARY (ADR 0023 Decision B): this adapter is invoice-EXECUTION transport only. It hands
 * the bank's ERP/AR system counterparty registrations + ALREADY-RECONCILED invoice
 * instructions and reads settlement status back. The regulated reconcile-before-invoice
 * pipeline — variance breaks, the 30-day Nebras dispute window, four-eyes invoice runs,
 * withholding disputed lines, net-settlement (ADR 0007) — stays INSIDE OFBO and never lives
 * here. (This is exactly why Kong Konnect billing must not replace P9.)
 *
 * Implements EXACTLY the P9 port contract (`registerCounterparty`, `issueInvoiceInstructions`,
 * `getSettlementStatus`) — nothing more. Transport injectable; with no base URL it binds an
 * in-memory fake ERP, so the contract runs the real call→parse path with no backend
 * (guardrail 4 / rung ②).
 */

export interface FinancialSystemConfig {
  /** Bank Profile — ERP / AR REST base URL. When unset, the in-memory fake is used. */
  baseUrl?: string
  /** Bank Profile — bearer provider. Required once baseUrl is set. */
  getToken?: (trace: { trace_id: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export class FinancialSystemError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'FinancialSystemError'
  }
}

const FAKE_BASE = 'https://fake.financial-system.invalid'
const SETTLEMENT_STATUSES = ['instructed', 'issued', 'settled', 'overdue', 'credit_noted'] as const
type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

const fakeErpFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init?.method ?? 'GET'
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (/\/counterparties$/.test(url) && method === 'POST') {
    const body = init?.body ? (JSON.parse(String(init.body)) as { organisation_id?: string }) : {}
    return json({ financial_system_ref: `fms-${body.organisation_id ?? 'unknown'}` })
  }
  if (/\/invoice-runs$/.test(url) && method === 'POST') return json({ accepted: true })
  if (/\/invoice-runs\/[^/]+\/status$/.test(url)) return json({ invoice_status: 'instructed' })
  return json({ error: 'unhandled' }, 404)
}

export function createFinancialSystemAdapter(config: FinancialSystemConfig = {}): FinancialSystemPort {
  const real = Boolean(config.baseUrl)
  const base = config.baseUrl ?? FAKE_BASE
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeErpFetch)

  async function call(path: string, trace: { trace_id: string }, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-fapi-interaction-id': trace.trace_id,
      ...((init?.headers as Record<string, string> | undefined) ?? {})
    }
    if (real) {
      if (!config.getToken) throw new FinancialSystemError(0, false, 'financial-system getToken is required when baseUrl is set')
      headers.authorization = `Bearer ${await config.getToken(trace)}`
    }
    const res = await doFetch(`${base}${path}`, { ...init, headers })
    if (!res.ok) throw new FinancialSystemError(res.status, res.status === 429 || res.status >= 500, `financial-system ${path} → ${res.status}`)
    return res
  }

  return {
    async registerCounterparty(org, trace) {
      const res = await call('/counterparties', trace, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(org) })
      return (await res.json()) as { financial_system_ref: string }
    },
    async issueInvoiceInstructions(run, trace) {
      // run.instructions are already reconciled-clean (OFBO gated them upstream) — this only executes.
      const res = await call('/invoice-runs', trace, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run) })
      return (await res.json()) as { accepted: boolean }
    },
    async getSettlementStatus(ref, trace) {
      const res = await call(`/invoice-runs/${encodeURIComponent(ref)}/status`, trace)
      const body = (await res.json()) as { invoice_status?: string }
      const status = body.invoice_status
      if (!status || !SETTLEMENT_STATUSES.includes(status as SettlementStatus)) {
        throw new FinancialSystemError(0, false, `financial-system returned an unknown invoice_status: ${String(status)}`)
      }
      return { invoice_status: status as SettlementStatus }
    }
  }
}

export function financialSystemFromEnv(env: NodeJS.ProcessEnv = process.env): FinancialSystemPort {
  const token = env.FINANCIAL_SYSTEM_TOKEN
  return createFinancialSystemAdapter({ baseUrl: env.FINANCIAL_SYSTEM_URL, getToken: token ? async () => token : undefined })
}
