/**
 * UI-06 — Analytics & Insights Dashboard data layer (BACKOFFICE-27 Executive Dashboard
 * + BACKOFFICE-31 Finance View, with the BACKOFFICE-40 freshness envelope). Calls the
 * Hono BFF over the OpenAPI contract paths, SERVER-SIDE only (Bearer from the httpOnly
 * cookie, never exposed to the browser). fetch + base URL are injectable for unit tests.
 * The analytics responses carry data free-form by contract, so the portal renders them
 * generically (contract-first); appearance = the Stitch screen.
 */

import { bffClient } from './bff'
import type { Schemas } from './contract-types'

/**
 * UIF-SPEC / ADR 0016 — a typed, named analytics panel the BFF may emit in `data.sections`.
 * The portal renders each `kind` with a bespoke UIF-01/01b primitive; unknown kinds degrade
 * to the generic grid. Sourced from the OpenAPI contract so it can't drift.
 */
export type AnalyticsSection = Schemas['AnalyticsSection']

/** Read `data.sections` off an analytics view (typed), or [] when the view is still free-form. */
export function sectionsOf(view: AnalyticsView): AnalyticsSection[] {
  const s = (view.data as { sections?: unknown }).sections
  return Array.isArray(s) ? (s as AnalyticsSection[]) : []
}

/** Mirrors the BFF FreshnessEnvelope (BACKOFFICE-40). */
export interface FreshnessEnvelope {
  source_published_at?: string
  view_refreshed_at: string
  stale: boolean
  stale_cause: string | null
}

/** An analytics view: free-form contract data + its freshness envelope. */
export interface AnalyticsView {
  data: Record<string, unknown>
  freshness: FreshnessEnvelope
}

export class AnalyticsApiError extends Error {
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

export interface AnalyticsApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: AnalyticsApiDeps) {
  return {
    ...bffClient(deps),
    trace: deps.traceId ?? crypto.randomUUID()
  }
}

const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })
const ANALYTICS_BASE = '/back-office/analytics'

const FALLBACK_FRESHNESS: FreshnessEnvelope = { view_refreshed_at: '', stale: true, stale_cause: 'no_response' }

/**
 * The analytics envelope is non-standard: `{ data, meta, freshness }` — freshness is a
 * top-level sibling of data (BACKOFFICE-40), not inside meta. Parse both; map non-2xx to
 * a typed error from the `{ error }` envelope.
 */
async function analyticsView(res: Response): Promise<AnalyticsView> {
  const body = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>
    error?: { code?: string; message?: string; remediation?: string; docs_url?: string }
    freshness?: FreshnessEnvelope
  }
  if (!res.ok) throw new AnalyticsApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.remediation, body.error?.docs_url)
  return { data: body.data ?? {}, freshness: body.freshness ?? FALLBACK_FRESHNESS }
}

/**
 * Generic getter for any BFF analytics-style view (a `{ data, meta, freshness }` GET).
 * `path` is the contract path under the BFF root (e.g. '/back-office/analytics/risk-view').
 * Shared by the analytics + risk consoles, which return the same envelope shape.
 */
export async function getAnalyticsView(token: string, path: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${path}`, { headers: authHeaders(token, trace) })
  return analyticsView(res)
}

/** BACKOFFICE-27 — Executive Dashboard (platform:analytics:read; commercial/programme angles scope-gated server-side). */
export async function getExecutiveDashboard(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, `${ANALYTICS_BASE}/executive-dashboard`, deps)
}

/**
 * BACKOFFICE-31 — Finance View (reconciliation:read). The contract declares NO query
 * parameters for this path (the BFF derives the period server-side), so the client sends
 * none — matching the contract surface exactly.
 */
export async function getFinanceView(token: string, deps: AnalyticsApiDeps = {}): Promise<AnalyticsView> {
  return getAnalyticsView(token, `${ANALYTICS_BASE}/finance-view`, deps)
}

/** Money guard for the generic renderer: integer minor units + ISO 4217. */
export function isMoney(v: unknown): v is { amount: number; currency: string } {
  return typeof v === 'object' && v !== null && typeof (v as { amount?: unknown }).amount === 'number' && typeof (v as { currency?: unknown }).currency === 'string'
}

export function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.currency} ${(m.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
