import type { FinancialSystemPort } from '../../interfaces.js'
import type { Money, TraceContext } from '../../types.js'

/**
 * P9 enterprise adapter — Kong Konnect Metering & Billing (OpenMeter-powered). Follows the ADR 0023
 * pattern. Maps the OFBO TPP-of-record financial operations onto Konnect's billing primitives:
 * a counterparty → a billing customer; an invoice run → pushed billing instructions; settlement →
 * the Konnect invoice status mapped to the OFBO 5-status lifecycle.
 *
 * IMPORTANT boundary (per the architecture discussion): Konnect supplies metering + invoice issuance
 * for the TPP re-billing line, but OFBO still owns the three-way reconciliation, the liability model
 * and CBUAE reporting — the scheme's billing authority is always the Nebras report, never a gateway
 * meter. This adapter is the financial-system sink, not the reconciliation source.
 *
 * The HTTP transport is an injected seam (fetchKongBillingHttp default; tests inject a fake — no
 * network, no new dependency). Konnect billing API paths are version-specific; they live in the
 * fetch transport / are overridable, so a version bump is a wiring change, not a core change.
 */

export interface KongBillingHttp {
  post(path: string, body: Record<string, unknown>, trace: TraceContext): Promise<{ status: number; json: unknown }>
  get(path: string, trace: TraceContext): Promise<{ status: number; json: unknown }>
}

export interface KongKonnectConfig {
  baseUrl: string
  /** Konnect billing product / rate-plan to attach counterparties to (optional). */
  productId?: string
  http: KongBillingHttp
}

type OfboInvoiceStatus = 'instructed' | 'issued' | 'settled' | 'overdue' | 'credit_noted'

// Konnect/OpenMeter invoice/billing status → the OFBO 5-status lifecycle. Unknown statuses are NOT
// silently coerced — fabricating a settlement state would be a financial-integrity defect.
const STATUS_MAP: Record<string, OfboInvoiceStatus> = {
  draft: 'instructed',
  pending: 'instructed',
  scheduled: 'instructed',
  issued: 'issued',
  open: 'issued',
  finalized: 'issued',
  paid: 'settled',
  settled: 'settled',
  overdue: 'overdue',
  past_due: 'overdue',
  uncollectible: 'overdue',
  void: 'credit_noted',
  voided: 'credit_noted',
  credited: 'credit_noted',
  credit_note: 'credit_noted'
}

interface IdResponse {
  id?: string
  result?: { id?: string }
}
interface StatusResponse {
  status?: string
  invoice_status?: string
  result?: { status?: string }
}

function readId(json: unknown): string | undefined {
  const r = json as IdResponse
  return r?.id ?? r?.result?.id
}

export class KongKonnectFinancialAdapter implements FinancialSystemPort {
  constructor(private readonly cfg: KongKonnectConfig) {}

  async registerCounterparty(
    org: { organisation_id: string; legal_name: string },
    trace: TraceContext
  ): Promise<{ financial_system_ref: string }> {
    const body: Record<string, unknown> = {
      name: org.legal_name, // legal entity name — not PSU data
      external_id: org.organisation_id,
      ...(this.cfg.productId ? { product_id: this.cfg.productId } : {})
    }
    const res = await this.cfg.http.post('/v1/billing/customers', body, trace)
    if (res.status < 200 || res.status >= 300) throw new Error(`P9: Konnect customer create failed (HTTP ${res.status})`)
    const ref = readId(res.json)
    if (!ref) throw new Error('P9: Konnect customer response missing id')
    return { financial_system_ref: ref }
  }

  async issueInvoiceInstructions(
    run: { invoice_run_id: string; instructions: Record<string, unknown>[] },
    trace: TraceContext
  ): Promise<{ accepted: boolean }> {
    const res = await this.cfg.http.post(
      '/v1/billing/invoice-runs',
      { invoice_run_id: run.invoice_run_id, lines: run.instructions },
      trace
    )
    if (res.status < 200 || res.status >= 300) throw new Error(`P9: Konnect invoice-run push failed (HTTP ${res.status})`)
    return { accepted: true }
  }

  async getSettlementStatus(ref: string, trace: TraceContext): Promise<{ invoice_status: OfboInvoiceStatus }> {
    const res = await this.cfg.http.get(`/v1/billing/customers/${encodeURIComponent(ref)}/settlement`, trace)
    if (res.status < 200 || res.status >= 300) throw new Error(`P9: Konnect settlement read failed (HTTP ${res.status})`)
    const r = res.json as StatusResponse
    const raw = (r.invoice_status ?? r.status ?? r.result?.status ?? '').toLowerCase()
    const mapped = Object.prototype.hasOwnProperty.call(STATUS_MAP, raw) ? STATUS_MAP[raw] : undefined
    if (!mapped) throw new Error(`P9: unmapped Konnect settlement status "${raw}" — refusing to fabricate a settlement state`)
    return { invoice_status: mapped }
  }
}

// money helper kept for parity with the port's Money convention (Konnect amounts are minor units).
export const toMinorUnits = (m: Money): { amount: number; currency: string } => ({ amount: m.amount, currency: m.currency })

// ── fetch-backed transport (production default) ──────────────────────────────────────────────

export function fetchKongBillingHttp(baseUrl: string, authHeader: string): KongBillingHttp {
  const base = baseUrl.replace(/\/$/, '')
  const headers = (trace: TraceContext) => ({
    authorization: authHeader,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-fapi-interaction-id': trace.trace_id
  })
  return {
    async post(path, body, trace) {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: headers(trace), body: JSON.stringify(body) })
      return { status: res.status, json: await res.json().catch(() => ({})) }
    },
    async get(path, trace) {
      const res = await fetch(`${base}${path}`, { method: 'GET', headers: headers(trace) })
      return { status: res.status, json: await res.json().catch(() => ({})) }
    }
  }
}

// ── Env factory ──────────────────────────────────────────────────────────────────────────────

export class KongKonnectConfigError extends Error {
  constructor(message: string) {
    super(`P9 Kong Konnect adapter misconfigured: ${message}`)
    this.name = 'KongKonnectConfigError'
  }
}

/** Construct from configuration. Required: P9_KONNECT_BASE_URL, P9_KONNECT_AUTH (full Authorization
 *  header). Optional: P9_KONNECT_PRODUCT_ID (billing product / rate plan). */
export function kongKonnectFromEnv(env: Record<string, string | undefined>): KongKonnectFinancialAdapter {
  const baseUrl = env.P9_KONNECT_BASE_URL
  if (!baseUrl) throw new KongKonnectConfigError('P9_KONNECT_BASE_URL is required (the Konnect billing API base URL)')
  const auth = env.P9_KONNECT_AUTH
  if (!auth) throw new KongKonnectConfigError('P9_KONNECT_AUTH is required (a full Authorization header)')
  return new KongKonnectFinancialAdapter({
    baseUrl,
    ...(env.P9_KONNECT_PRODUCT_ID ? { productId: env.P9_KONNECT_PRODUCT_ID } : {}),
    http: fetchKongBillingHttp(baseUrl, auth)
  })
}
