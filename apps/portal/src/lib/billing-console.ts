/**
 * BILL-09/BILL-10 — tenant LFI billing console data layer. Every call is server-side:
 * the httpOnly portal token is forwarded to the BFF and never enters browser storage.
 * Behaviour and wire names come from the OpenAPI billing paths; the console response is
 * intentionally free-form in the contract, so the view types below describe only fields
 * the portal reads and remain tolerant of additive server fields.
 */

import { bffClient } from './bff'
import type { Schemas } from './contract-types'

export type BillingScenario = Schemas['BillingProfitabilityScenario']

export interface BillingFreshness {
  source_published_at?: string
  view_refreshed_at: string
  stale: boolean
  stale_cause: string | null
}

export interface BillingAmounts {
  receivable_milli_fils: number
  hub_cost_milli_fils: number
  liability_provision_milli_fils: number
  tpp_aas_margin_milli_fils: number
  profit_milli_fils: number
}

export interface BillingProfitabilityRow extends Partial<BillingAmounts> {
  tpp_id?: string
  product_family?: string
  profit_aed?: number
  source_refs?: string[]
}

export interface BillingProfitabilityReport {
  period: string
  currency: 'AED'
  totals: BillingAmounts
  by_tpp: BillingProfitabilityRow[]
  by_product_family: BillingProfitabilityRow[]
  reconciliation: { balanced: boolean; delta_milli_fils: number }
}

export interface BillingAssuranceFinding {
  code: string
  title: string
  amount_milli_fils: number
  status: string
  owner: string
  source_refs: string[]
}

export interface BillingRevenueAssurance {
  period: string
  generated_at: string
  currency: 'AED'
  metering_coverage_percent: number
  gross_receivable_milli_fils: number
  leakage_milli_fils: number
  leakage_aed: number
  leakage_percent: number
  counterfactual_opportunity_milli_fils: number
  counterfactual_opportunity_aed: number
  recoverable_milli_fils: number
  recovered_revenue_milli_fils: number
  recovered_revenue_aed: number
  outstanding_recoverable_milli_fils: number
  findings: BillingAssuranceFinding[]
  target: { threshold_percent: number; comparison: string; met: boolean }
  dispute_window: { raised: number; missed: number; target_missed: number }
  [key: string]: unknown
}

export interface BillingCollectionsSummary {
  open_invoice_count: number
  open_milli_fils: number
  settlement_break_count: number
  settlement_expected_net_milli_fils: number
  settlement_received_milli_fils: number
  settlement_residue_milli_fils: number
  dunning_by_state: Record<string, number>
  dso_by_tpp: Array<Record<string, unknown>>
}

export interface BillingAccountingClosePack {
  period: string
  batch_id: string
  account_profile_ref: string
  balanced: boolean
  journal_count: number
  debit_fils: number
  credit_fils: number
  output_vat_fils: number
  settlement_residue_fils: number
  invoice_document_ids: string[]
  payable_source_ids: string[]
  settlement_references: string[]
}

export interface BillingRateCardSummary {
  version: string
  label: string
  effective_from: string
  currency: 'AED'
  year_anchor: { date: string; status: 'ASSUMED' | 'CONFIRMED'; note: string }
  receivable: Record<string, unknown>
  payable_hub: Record<string, unknown>
  [key: string]: unknown
}

export interface BillingConsoleData {
  bank_id: string
  period: string
  rate_card?: BillingRateCardSummary
  invoice?: { template_ref: string; brand_key: string }
  asp_route_profile?: string
  collection_rail_policy?: { preferred: string; fallback: string }
  collections: BillingCollectionsSummary | null
  accounting_close_pack: BillingAccountingClosePack | null
  revenue_assurance: BillingRevenueAssurance | null
  profitability: BillingProfitabilityReport | null
  insurance: { status: 'deferred'; dependency: string; story: 'BILL-06' }
}

export interface BillingConsoleView {
  data: BillingConsoleData
  freshness: BillingFreshness
}

export interface BillingScenarioResult {
  scenario_id: string
  effective_date?: string
  baseline?: BillingAmounts
  projected?: BillingAmounts
  delta_profit_milli_fils: number
  overage?: {
    units: number
    silent_default_revenue_milli_fils: number
    proposed_revenue_milli_fils: number
    incremental_revenue_milli_fils: number
  }
}

export interface BillingArtifact {
  schema_version: string
  sha256: string
  period?: string
  bank_id?: string
  generated_at?: string
  record_counts?: Record<string, number>
  [key: string]: unknown
}

export interface BillingWriteResult {
  ok: boolean
  simulation?: BillingScenarioResult
  error?: string
  remediation?: string | null
  docsUrl?: string | null
  values?: Record<string, string>
}

export class BillingConsoleApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly remediation?: string,
    readonly docsUrl?: string
  ) {
    super(message)
  }
}

export interface BillingConsoleApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

const FALLBACK_FRESHNESS: BillingFreshness = { view_refreshed_at: '', stale: true, stale_cause: 'no_response' }

function resolve(deps: BillingConsoleApiDeps) {
  return { ...bffClient(deps), trace: deps.traceId ?? crypto.randomUUID() }
}

const authHeaders = (token: string, trace: string) => ({
  authorization: `Bearer ${token}`,
  'x-fapi-interaction-id': trace
})

const postHeaders = (token: string, trace: string, idempotencyKey: string) => ({
  ...authHeaders(token, trace),
  'idempotency-key': idempotencyKey,
  'content-type': 'application/json'
})

const jsonPostHeaders = (token: string, trace: string) => ({
  ...authHeaders(token, trace),
  'content-type': 'application/json'
})

async function body<T>(res: Response): Promise<{ data: T; freshness?: BillingFreshness }> {
  const parsed = (await res.json().catch(() => ({}))) as {
    data?: T
    freshness?: BillingFreshness
    error?: { code?: string; message?: string; remediation?: string; docs_url?: string }
  }
  if (!res.ok) {
    throw new BillingConsoleApiError(
      parsed.error?.code ?? 'BACKOFFICE.ERROR',
      parsed.error?.message ?? `HTTP ${res.status}`,
      res.status,
      parsed.error?.remediation,
      parsed.error?.docs_url
    )
  }
  return { data: parsed.data as T, freshness: parsed.freshness }
}

/** GET /back-office/billing/console — tenant comes only from the verified token claim. */
export async function getBillingConsole(
  token: string,
  period: string,
  deps: BillingConsoleApiDeps = {}
): Promise<BillingConsoleView> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/console?period=${encodeURIComponent(period)}`, {
    headers: authHeaders(token, trace)
  })
  const parsed = await body<BillingConsoleData>(res)
  return { data: parsed.data, freshness: parsed.freshness ?? FALLBACK_FRESHNESS }
}

/** POST /back-office/billing/profitability:simulate — pure and non-persisting. */
export async function simulateProfitability(
  token: string,
  input: { period: string; scenario: BillingScenario },
  deps: BillingConsoleApiDeps = {}
): Promise<BillingScenarioResult> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/profitability:simulate`, {
    method: 'POST',
    headers: jsonPostHeaders(token, trace),
    body: JSON.stringify(input)
  })
  return (await body<BillingScenarioResult>(res)).data
}

/** POST /back-office/billing/exports:cbuae-fee-review — audited annual review artifact. */
export async function generateCbuaeFeeReview(
  token: string,
  input: { period: string; scenarios: BillingScenario[] },
  idempotencyKey: string,
  deps: BillingConsoleApiDeps = {}
): Promise<BillingArtifact> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/exports:cbuae-fee-review`, {
    method: 'POST',
    headers: postHeaders(token, trace, idempotencyKey),
    body: JSON.stringify(input)
  })
  return (await body<BillingArtifact>(res)).data
}

/** GET /back-office/billing/export — audited, complete tenant portability artifact. */
export async function getPortableBillingExport(
  token: string,
  deps: BillingConsoleApiDeps = {}
): Promise<BillingArtifact> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/back-office/billing/export`, { headers: authHeaders(token, trace) })
  return (await body<BillingArtifact>(res)).data
}

/** Billing facts use integer milli-fils (100,000 per AED), not API minor units. */
export function formatMilliFils(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  return `${sign}AED ${(Math.abs(value) / 100_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

export function humanizeBilling(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
