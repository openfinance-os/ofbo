/**
 * UI-08 — TPP Billing & Registry data layer (BACKOFFICE-71 consuming-TPP registry,
 * BACKOFFICE-72 P9 financial-system registration, BACKOFFICE-73 monthly invoicing).
 * Calls the Hono BFF over the OpenAPI contract paths, SERVER-SIDE only (Bearer from the
 * httpOnly cookie, never in the browser). fetch + base URL are injectable for unit tests.
 * Finance scope. Behaviour/data = the contract; appearance = the Stitch screen.
 */

import type { ApprovalRequest } from './approvals'
import { bffClient } from './bff'

export interface Money {
  amount: number
  currency: string
}

/** Mirrors the OpenAPI TppCounterparty wire shape (BACKOFFICE-71). */
export interface TppCounterparty {
  organisation_id: string
  legal_name: string
  registration_number: string | null
  directory_contacts: unknown[]
  directory_synced_at: string
  production_status: string
  first_traffic_at: string | null
  registration_state: string
  financial_system_ref: string | null
  unbilled_traffic: boolean
  mtd_fee_accrual: Money | null
  channel: string
}

/** Mirrors the OpenAPI InvoiceRun wire shape (BACKOFFICE-73). */
export interface InvoiceRun {
  invoice_run_id: string
  billing_period: string
  record_set_id: string
  status: string
  approval_id: string | null
  invoices: unknown[]
  withheld_line_count: number
  net_settlement_offset: Money | null
}

/** Result of a directory sync (BACKOFFICE-71). */
export interface DirectorySyncResult {
  synced_count?: number
  [k: string]: unknown
}

/**
 * Registration states from which a P9 financial-system registration can be initiated —
 * a subset of the contract registration_state enum [unregistered, onboarding, registered,
 * suspended]: a counterparty not yet registered in the financial-management system.
 */
export const REGISTERABLE_STATES = ['unregistered', 'onboarding'] as const

export class TppBillingApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface TppBillingApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: TppBillingApiDeps) {
  return {
    ...bffClient(deps),
    trace: deps.traceId ?? crypto.randomUUID()
  }
}

async function envelope<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string }; meta?: Record<string, unknown> }
  if (!res.ok) throw new TppBillingApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  return { data: body.data as T, meta: body.meta }
}

const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })
const mutationHeaders = (token: string, trace: string, idempotencyKey: string) => ({ ...authHeaders(token, trace), 'idempotency-key': idempotencyKey })

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export interface CounterpartyQuery {
  cursor?: string
  limit?: number
  production_status?: string
  registration_state?: string
  unbilled_traffic?: boolean
}

/** BACKOFFICE-71 — consuming-TPP registry list (billing:read). */
export async function listCounterparties(token: string, query: CounterpartyQuery = {}, deps: TppBillingApiDeps = {}): Promise<{ counterparties: TppCounterparty[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const q = qs({ cursor: query.cursor, limit: query.limit, production_status: query.production_status, registration_state: query.registration_state, unbilled_traffic: query.unbilled_traffic })
  const res = await f(`${base}/back-office/tpp-counterparties${q}`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<TppCounterparty[]>(res)
  return { counterparties: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/** BACKOFFICE-73 — monthly invoice-run list (billing:read). */
export async function listInvoiceRuns(token: string, query: { cursor?: string; limit?: number } = {}, deps: TppBillingApiDeps = {}): Promise<{ runs: InvoiceRun[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/invoice-runs${qs({ cursor: query.cursor, limit: query.limit })}`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<InvoiceRun[]>(res)
  return { runs: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/** BACKOFFICE-71 — sync the registry from the Trust Framework Directory (platform:operations:write). 202, Idempotency-Key. */
export async function syncDirectory(token: string, idempotencyKey: string, deps: TppBillingApiDeps = {}): Promise<DirectorySyncResult> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/tpp-counterparties:sync-directory`, { method: 'POST', headers: mutationHeaders(token, trace, idempotencyKey) })
  return (await envelope<DirectorySyncResult>(res)).data
}

/** BACKOFFICE-72 — register a counterparty in the P9 financial-management system (billing:write). 202, Idempotency-Key. */
export async function registerFinancialSystem(token: string, organisationId: string, idempotencyKey: string, deps: TppBillingApiDeps = {}): Promise<TppCounterparty> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/tpp-counterparties/${encodeURIComponent(organisationId)}:register-financial-system`, { method: 'POST', headers: mutationHeaders(token, trace, idempotencyKey) })
  return (await envelope<TppCounterparty>(res)).data
}

/**
 * BACKOFFICE-73 — create a monthly invoice run (billing:write). Four-eyes: returns 202 +
 * an approval_request (never dispatched inline; a second principal approves before P9 dispatch).
 */
export async function createInvoiceRun(token: string, body: { billing_period: string; record_set_id: string }, idempotencyKey: string, deps: TppBillingApiDeps = {}): Promise<ApprovalRequest> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/invoice-runs`, {
    method: 'POST',
    headers: { ...mutationHeaders(token, trace, idempotencyKey), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return (await envelope<ApprovalRequest>(res)).data
}

export function formatMoney(m: Money | null): string {
  if (!m) return '—'
  return `${m.currency} ${(m.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
