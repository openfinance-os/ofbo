/**
 * UI-03 — Reconciliation Console data layer (BACKOFFICE-01/-02/-03/-04/-06).
 * Calls the Hono BFF over the OpenAPI contract paths, SERVER-SIDE only (Bearer
 * from the httpOnly cookie, never exposed to the browser). fetch + base URL are
 * injectable so it unit-tests without a running BFF. Behaviour/data = the contract;
 * appearance = the Stitch "Reconciliation Console" screen.
 */

import { bffClient } from './bff'

export interface Money {
  amount: number
  currency: string
}

/** Mirrors the OpenAPI ReconciliationRun wire shape (BACKOFFICE-01). */
export interface ReconciliationRun {
  id: string
  run_id: string
  run_type: string
  status: string
  reconciliation_window_start: string
  reconciliation_window_end: string
  line_count_total: number
  line_count_matched: number
  line_count_unmatched: number
  line_count_disputed: number
  failure_reason: string | null
  created_at: string
}

/** Mirrors the OpenAPI ReconciliationBreak wire shape (BACKOFFICE-02). */
export interface ReconciliationBreak {
  id: string
  run_id: string
  client_id: string
  channel: string
  line_type: string
  status: string
  variance_amount: Money | null
  variance_count: number | null
  source_a_ref: string | null
  source_b_ref: string | null
  source_c_ref: string | null
  assigned_to: string | null
  sla_clock_started_at: string | null
  resolution_outcome: string | null
  resolution_note: string | null
  nebras_dispute_case_id: string | null
  reopened_count: number
  created_at: string
}

/** Resolution outcomes — verbatim from the BFF RESOLVE_OUTCOMES (BACKOFFICE-04). */
export const RESOLVE_OUTCOMES = ['resolved_matched', 'resolved_internal_correction', 'escalated_fintech_billing'] as const
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number]
/** A resolution note is mandatory and must be at least this many characters (BFF MIN_NOTE). */
export const MIN_RESOLUTION_NOTE = 20

export class ReconApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface ReconApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: ReconApiDeps) {
  return {
    ...bffClient(deps),
    trace: deps.traceId ?? crypto.randomUUID()
  }
}

async function envelope<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string }; meta?: Record<string, unknown> }
  if (!res.ok) throw new ReconApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  return { data: body.data as T, meta: body.meta }
}

const authHeaders = (token: string, trace: string) => ({ authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace })
const RECON_BASE = '/back-office/reconciliation'

export interface RunListQuery {
  cursor?: string
  limit?: number
  run_type?: string
  status?: string
}
export interface BreakListQuery {
  cursor?: string
  limit?: number
  run_id?: string
  status?: string
  line_type?: string
  client_id?: string
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** BACKOFFICE-01 — list reconciliation runs (reconciliation:read). */
export async function listRuns(token: string, query: RunListQuery = {}, deps: ReconApiDeps = {}): Promise<{ runs: ReconciliationRun[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const query_ = qs({ cursor: query.cursor, limit: query.limit, run_type: query.run_type, status: query.status })
  const res = await f(`${base}${RECON_BASE}/runs${query_}`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<ReconciliationRun[]>(res)
  return { runs: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/** BACKOFFICE-02 — list reconciliation breaks, the break queue (reconciliation:read). */
export async function listBreaks(token: string, query: BreakListQuery = {}, deps: ReconApiDeps = {}): Promise<{ breaks: ReconciliationBreak[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const query_ = qs({ cursor: query.cursor, limit: query.limit, run_id: query.run_id, status: query.status, line_type: query.line_type, client_id: query.client_id })
  const res = await f(`${base}${RECON_BASE}/breaks${query_}`, { headers: authHeaders(token, trace) })
  const { data, meta } = await envelope<ReconciliationBreak[]>(res)
  return { breaks: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/**
 * BACKOFFICE-03 — claim a break, starting the SLA clock (finance:reconciliation:write).
 * Mutating → Idempotency-Key mandatory.
 */
export async function claimBreak(token: string, breakId: string, idempotencyKey: string, deps: ReconApiDeps = {}): Promise<ReconciliationBreak> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${RECON_BASE}/breaks/${encodeURIComponent(breakId)}/claim`, {
    method: 'POST',
    headers: { ...authHeaders(token, trace), 'idempotency-key': idempotencyKey }
  })
  return (await envelope<ReconciliationBreak>(res)).data
}

/**
 * BACKOFFICE-04/-06 — resolve a break with an outcome + note (finance:reconciliation:write).
 * Mutating → Idempotency-Key mandatory; the note must be ≥ MIN_RESOLUTION_NOTE chars (BFF-enforced).
 */
export async function resolveBreak(
  token: string,
  breakId: string,
  body: { resolution_outcome: ResolveOutcome; resolution_note: string },
  idempotencyKey: string,
  deps: ReconApiDeps = {}
): Promise<ReconciliationBreak> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${RECON_BASE}/breaks/${encodeURIComponent(breakId)}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders(token, trace), 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return (await envelope<ReconciliationBreak>(res)).data
}

/** BACKOFFICE-11 — single break detail, the three-source side-by-side diff view (reconciliation:read). */
export async function getBreak(token: string, breakId: string, deps: ReconApiDeps = {}): Promise<ReconciliationBreak> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${RECON_BASE}/breaks/${encodeURIComponent(breakId)}`, { headers: authHeaders(token, trace) })
  return (await envelope<ReconciliationBreak>(res)).data
}

/** Result of a Nebras escalation (BACKOFFICE-05). */
export interface NebrasEscalationResult {
  break_id: string
  status: string
  nebras_dispute_case_id: string
}
/** Break states from which a one-click Nebras dispute can be raised (BFF: flagged|assigned). */
export const ESCALATABLE_STATES = ['flagged', 'assigned'] as const

/**
 * BACKOFFICE-05 — one-click Nebras dispute escalation (finance:disputes:write).
 * POST /breaks/{id}/escalate-nebras; mutating → Idempotency-Key mandatory. Propagates
 * to the Nebras Case & Dispute Management surface via P6 in the BFF.
 */
export async function escalateToNebras(token: string, breakId: string, idempotencyKey: string, deps: ReconApiDeps = {}): Promise<NebrasEscalationResult> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${RECON_BASE}/breaks/${encodeURIComponent(breakId)}/escalate-nebras`, {
    method: 'POST',
    headers: { ...authHeaders(token, trace), 'idempotency-key': idempotencyKey }
  })
  return (await envelope<NebrasEscalationResult>(res)).data
}

/** Format integer minor units + ISO 4217 as a display string (no locale PII). */
export function formatMoney(m: Money | null): string {
  if (!m) return '—'
  const major = (m.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${m.currency} ${major}`
}
