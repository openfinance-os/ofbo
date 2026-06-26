import type { FinancialSystemPort } from '../../interfaces.js'

/**
 * P9 — Financial management system enterprise adapter (pre-staged per ADR 0024, rung ③).
 *
 * BOUNDARY (ADR 0024 Decision B): this adapter is invoice-EXECUTION transport only. It hands
 * the bank's ERP/AR system counterparty registrations + ALREADY-RECONCILED invoice
 * instructions and reads settlement status back. The regulated reconcile-before-invoice
 * pipeline — variance breaks, the 30-day Nebras dispute window, four-eyes invoice runs,
 * withholding disputed lines, net-settlement (ADR 0007) — stays INSIDE OFBO and never lives
 * here. (This is exactly why Kong Konnect billing must not replace P9.)
 *
 * Implements EXACTLY the P9 port contract (`registerCounterparty`, `issueInvoiceInstructions`,
 * `getSettlementStatus`) — nothing more. Transport injectable; fail-closed when unconfigured — tests inject a fake transport, exercising
 * the real call→parse path with no backend
 * (guardrail 4 / rung ②).
 */

export interface FinancialSystemConfig {
  /** Bank Profile — ERP / AR REST base URL. Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
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

const SETTLEMENT_STATUSES = ['instructed', 'issued', 'settled', 'overdue', 'credit_noted'] as const
type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

export function createFinancialSystemAdapter(config: FinancialSystemConfig = {}): FinancialSystemPort {
  // FAIL-CLOSED: no silent fake under the enterprise profile — base URL + token are mandatory.
  if (!config.baseUrl) throw new FinancialSystemError(0, false, 'financial-system baseUrl is required (fail-closed)')
  if (!config.getToken) throw new FinancialSystemError(0, false, 'financial-system getToken is required')
  const getToken = config.getToken
  const base = config.baseUrl
  const doFetch = config.fetchImpl ?? globalThis.fetch

  async function call(path: string, trace: { trace_id: string }, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-fapi-interaction-id': trace.trace_id,
      authorization: `Bearer ${await getToken(trace)}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {})
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
  if (!env.FINANCIAL_SYSTEM_URL || !token) {
    throw new FinancialSystemError(0, false, 'financial-system adapter misconfigured: set FINANCIAL_SYSTEM_URL and FINANCIAL_SYSTEM_TOKEN')
  }
  return createFinancialSystemAdapter({ baseUrl: env.FINANCIAL_SYSTEM_URL, getToken: async () => token })
}
