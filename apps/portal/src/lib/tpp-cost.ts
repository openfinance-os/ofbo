/**
 * BILL-17 — TPP Cost Management data layer (the payable side of the billing console).
 *
 * Every call is server-side: the httpOnly portal token is forwarded to the BFF and never enters
 * browser storage. Shapes are bound to the OpenAPI contract rather than to the ledger — the finer
 * milli-fils precision stays behind the storage boundary and everything here is `Money`, integer
 * minor units, per the CODE-03 ruling.
 */

import { bffClient } from './bff'
import type { Schemas } from './contract-types'

export type Money = { amount: number; currency: string }
export type TppCostCloseState = 'open' | 'blocked' | 'closed'
export type TppCostDispatchState = 'pending' | 'dispatched' | 'accepted' | 'rejected' | 'failed'

export interface TppCostPeriodBlocker {
  line_ref: string
  break_type: string
  cost_recipient_type: 'nebras' | 'underlying_lfi'
  cost_recipient_id: string
  variance: Money
  reconciliation_break_id: string | null
}

export interface TppCostPayable {
  payable_id: string
  period: string
  cost_recipient_type: 'nebras' | 'underlying_lfi'
  cost_recipient_id: string
  document_reference: string
  gross_amount: Money
  net_amount: Money
  vat_amount: Money
  approval_request_id: string | null
  dispatch_state: TppCostDispatchState | null
  dispatched_at: string | null
  netted_against: Money | null
}

export interface TppCostPeriod {
  period: string
  close_state: TppCostCloseState
  closed_at: string | null
  initiated_by: string | null
  approved_by: string | null
  approval_request_id: string | null
  feeds_monthly_signoff: boolean
  open_break_count: number
  blockers: TppCostPeriodBlocker[]
  payables: TppCostPayable[]
}

/**
 * ADR-0004 type-level drift guard. A field RENAMED or removed in the spec fails `pnpm typecheck`
 * rather than a test — the generated schema types make every field optional, so structural
 * assignability would prove nothing.
 */
import type { AssertContract, KeysConformToContract } from './contract-types'
export type TppCostPeriodContractGuard = AssertContract<KeysConformToContract<TppCostPeriod, Schemas['TppCostPeriod']>>
export type TppCostPayableContractGuard = AssertContract<KeysConformToContract<TppCostPayable, Schemas['TppCostPayable']>>
export type TppCostBlockerContractGuard =
  AssertContract<KeysConformToContract<TppCostPeriodBlocker, Schemas['TppCostPeriodBlocker']>>

export class TppCostApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation?: string,
    readonly docsUrl?: string
  ) {
    super(message)
    this.name = 'TppCostApiError'
  }
}

export interface TppCostApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: TppCostApiDeps) {
  return { ...bffClient(deps), trace: deps.traceId ?? crypto.randomUUID() }
}

const authHeaders = (token: string, trace: string) => ({
  authorization: `Bearer ${token}`,
  'x-fapi-interaction-id': trace
})

const mutateHeaders = (token: string, trace: string, idempotencyKey: string) => ({
  ...authHeaders(token, trace),
  'idempotency-key': idempotencyKey
})

/** Parses `remediation` and `docs_url`, both REQUIRED on the spec's ErrorEnvelope (UX-06). */
async function envelope<T>(res: Response): Promise<T> {
  const parsed = (await res.json().catch(() => ({}))) as {
    data?: T
    error?: { code?: string; message?: string; remediation?: string; docs_url?: string }
  }
  if (!res.ok) {
    throw new TppCostApiError(
      parsed.error?.code ?? 'BACKOFFICE.ERROR',
      parsed.error?.message ?? `HTTP ${res.status}`,
      res.status,
      parsed.error?.remediation,
      parsed.error?.docs_url
    )
  }
  return parsed.data as T
}

/** GET /back-office/billing/cost-periods/{period} — close state, payables and blockers in one read. */
export async function getCostPeriod(
  token: string,
  period: string,
  deps: TppCostApiDeps = {}
): Promise<TppCostPeriod> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/cost-periods/${encodeURIComponent(period)}`, {
    headers: authHeaders(token, trace)
  })
  return envelope<TppCostPeriod>(res)
}

/**
 * POST .../{period}:close — four-eyes. Returns `202` + the approval request; it NEVER closes inline.
 */
export async function requestCostPeriodClose(
  token: string,
  period: string,
  idempotencyKey: string,
  deps: TppCostApiDeps = {}
): Promise<{ approval_request_id: string; state: string; operation_type: string }> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/cost-periods/${encodeURIComponent(period)}:close`, {
    method: 'POST',
    headers: mutateHeaders(token, trace, idempotencyKey)
  })
  return envelope<{ approval_request_id: string; state: string; operation_type: string }>(res)
}

/** POST /back-office/billing/payables/{payable_id}:dispatch — authorises honouring the scheme debit. */
export async function dispatchPayable(
  token: string,
  payableId: string,
  idempotencyKey: string,
  deps: TppCostApiDeps = {}
): Promise<{
  payable_id: string
  dispatch_ref: string
  dispatch_state: TppCostDispatchState
  payable_status: string
  replayed: boolean
  approval_request_id: string
  dispatched_at: string
}> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/payables/${encodeURIComponent(payableId)}:dispatch`, {
    method: 'POST',
    headers: mutateHeaders(token, trace, idempotencyKey)
  })
  return envelope(res)
}

/** Money is integer MINOR units (fils for AED) — 100 per AED, not the ledger's 100,000 milli-fils. */
export function formatMoney(value: Money | null | undefined): string {
  if (!value || !Number.isFinite(value.amount)) return '—'
  const sign = value.amount < 0 ? '−' : ''
  return `${sign}${value.currency} ${(Math.abs(value.amount) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/**
 * Total by stream, so the console can lead with "what we owe the Hub" and "what we owe LFIs"
 * separately. ADR 0007 keeps the three cost totals apart; summing them into one number would hide
 * the only distinction the payable side is organised around.
 */
export function totalsByRecipient(payables: readonly TppCostPayable[]): {
  nebras: Money
  underlyingLfi: Money
  total: Money
  currency: string
} {
  const currency = payables[0]?.net_amount.currency ?? 'AED'
  const sum = (type: 'nebras' | 'underlying_lfi') =>
    payables.filter((p) => p.cost_recipient_type === type).reduce((acc, p) => acc + p.net_amount.amount, 0)
  const nebras = sum('nebras')
  const lfi = sum('underlying_lfi')
  return {
    nebras: { amount: nebras, currency },
    underlyingLfi: { amount: lfi, currency },
    total: { amount: nebras + lfi, currency },
    currency
  }
}

/** Net variance across the blockers holding a period open — the amount actually in dispute. */
export function blockedVariance(blockers: readonly TppCostPeriodBlocker[]): Money {
  const currency = blockers[0]?.variance.currency ?? 'AED'
  return { amount: blockers.reduce((acc, b) => acc + Math.abs(b.variance.amount), 0), currency }
}

/**
 * How many payables are still unauthorised or in flight.
 *
 * `accepted` is the only state where the debit is settled. `rejected` and `failed` are terminal but
 * NOT settled, so they count as outstanding — a rejected direct debit is money still owed, and
 * reporting it as done is how a payable goes quiet.
 */
export function dispatchSummary(payables: readonly TppCostPayable[]): {
  settled: number
  inFlight: number
  outstanding: number
} {
  let settled = 0
  let inFlight = 0
  let outstanding = 0
  for (const payable of payables) {
    if (payable.dispatch_state === 'accepted') settled += 1
    else if (payable.dispatch_state === 'dispatched' || payable.dispatch_state === 'pending') inFlight += 1
    else outstanding += 1
  }
  return { settled, inFlight, outstanding }
}

export function humanizeCost(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
