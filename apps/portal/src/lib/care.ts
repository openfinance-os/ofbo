/**
 * UI-02 — Customer Care Console data layer. Calls the Hono BFF over HTTP using the
 * OpenAPI contract paths (the portal's first full-pipeline use of the API client).
 * Invoked SERVER-SIDE from the page (token from the httpOnly cookie → Bearer, never
 * exposed to the browser). fetch + base URL are injectable so it unit-tests without
 * a running BFF. Behaviour/data are the contract's; appearance is the Stitch screen.
 */

import { bffClient } from './bff'
import type { Schemas, KeysConformToContract, AssertContract } from './contract-types'

export const IDENTIFIER_TYPES = ['bank_customer_id', 'iban', 'emirates_id'] as const
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number]

/** Mirrors the OpenAPI ConsentAdminView (no PSU PII beyond the searched identifier). */
export interface CareConsent {
  consent_id: string
  tpp: { client_id: string; display_name: string }
  purpose: string
  scope: string[]
  status: string
  granted_at: string
  expires_at: string | null
  last_access_at: string | null
}
export interface ConsentSearchResult {
  psu: { bank_customer_id: string; account_count: number }
  consents: CareConsent[]
}

// ADR-0004 drift guard — fails typecheck if the contract renames/removes a CareConsent field.
export type CareConsentContractGuard = AssertContract<KeysConformToContract<CareConsent, Schemas['ConsentAdminView']>>

/** Mirrors the OpenAPI ConsentTimelineEvent (BACKOFFICE-19, audit-store projection). */
export interface CareTimelineEvent {
  id: string
  consent_id: string | null
  psu_identifier: string | null
  event_type: 'granted' | 'accessed' | 'modified' | 'revoked'
  event_subtype: string | null
  event_data: unknown
  acting_principal: string | null
  created_at: string
}
export interface CareTimeline {
  events: CareTimelineEvent[]
  next_cursor: string | null
}

/** Admin revoke reason codes (BACKOFFICE-17). FRAUD_SUSPECTED is Risk-only (-22). */
export const REVOKE_REASON_CODES = ['TPP_REQUEST', 'CLIENT_INSTRUCTION', 'REGULATORY'] as const
export type RevokeReasonCode = (typeof REVOKE_REASON_CODES)[number]

/** Mirrors the contract RevocationResult.data (BACKOFFICE-17). */
export interface RevocationResult {
  consent_id: string
  status: string
  nebras_propagation_ms: number
  psu_notified: boolean
}

/** Dispute types — verbatim from the contract DisputeCreate.dispute_type enum. */
export const DISPUTE_TYPES = ['unauthorised_payment', 'unrecognised_tpp', 'consent_complaint', 'data_misuse_complaint', 'other'] as const
export type DisputeType = (typeof DISPUTE_TYPES)[number]

/** Dispute create input (BACKOFFICE-20) — the contract's DisputeCreate, no PSU PII beyond the identifier. */
export interface DisputeCreateInput {
  psu_identifier: string
  dispute_type: DisputeType
  originating_payment_id?: string
  dispute_reason_code?: string
}
/** Mirrors the contract DisputeCase (201 data) — the case id is `id`. */
export interface DisputeRecord {
  id: string
  state: string
  dispute_type: string
  originating_payment_id: string | null
}

export class CareApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface CareApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

function resolve(deps: CareApiDeps) {
  return {
    ...bffClient(deps),
    trace: deps.traceId ?? crypto.randomUUID()
  }
}

async function envelope<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string }; meta?: Record<string, unknown> }
  if (!res.ok) throw new CareApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  return { data: body.data as T, meta: body.meta }
}

async function unwrap<T>(res: Response): Promise<T> {
  return (await envelope<T>(res)).data
}

/**
 * BACKOFFICE-16 — PSU-centric consent search. GET /consents:search-psu (consents:admin).
 * Returns the PSU + its consents (TPP identity, purpose, scope, lifecycle status, last
 * access). The identifier is sent only to the BFF (redacted at audit emission there).
 */
export async function searchConsents(token: string, identifierType: IdentifierType, identifier: string, deps: CareApiDeps = {}): Promise<ConsentSearchResult> {
  const { base, f, trace } = resolve(deps)
  const url = `${base}/consents:search-psu?identifier_type=${encodeURIComponent(identifierType)}&identifier=${encodeURIComponent(identifier)}`
  const res = await f(url, { headers: { authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace } })
  return unwrap<ConsentSearchResult>(res)
}

/**
 * BACKOFFICE-19 — 24-month per-PSU consent audit-trail timeline (audit:read).
 * GET /psu/{psu_identifier}/audit-trail. The data array is the chronological
 * events; meta.next_cursor pages older events (the console renders the first page).
 */
export async function getPsuAuditTrail(token: string, psuIdentifier: string, deps: CareApiDeps = {}): Promise<CareTimeline> {
  const { base, f, trace } = resolve(deps)
  const url = `${base}/psu/${encodeURIComponent(psuIdentifier)}/audit-trail`
  const res = await f(url, { headers: { authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace } })
  const { data, meta } = await envelope<CareTimelineEvent[]>(res)
  return { events: data ?? [], next_cursor: (meta?.next_cursor as string | null) ?? null }
}

/**
 * BACKOFFICE-17 — single-consent admin revocation (consents:admin). POST
 * /consents/{id}:revoke-admin; mutating, so an Idempotency-Key is mandatory (a
 * replay within 24h returns the original result). Propagates to Nebras via P6.
 */
export async function revokeConsent(
  token: string,
  consentId: string,
  reasonCode: RevokeReasonCode,
  idempotencyKey: string,
  deps: CareApiDeps = {}
): Promise<RevocationResult> {
  const { base, f, trace } = resolve(deps)
  const url = `${base}/consents/${encodeURIComponent(consentId)}:revoke-admin`
  const res = await f(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-fapi-interaction-id': trace,
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ reason_code: reasonCode })
  })
  return unwrap<RevocationResult>(res)
}

/**
 * BACKOFFICE-20 — one-click unauthorized-payment dispute (disputes:admin). POST
 * /disputes; mutating (Idempotency-Key mandatory). Nebras-linked via P6 in the BFF.
 */
export async function createDispute(token: string, input: DisputeCreateInput, idempotencyKey: string, deps: CareApiDeps = {}): Promise<DisputeRecord> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}/disputes`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-fapi-interaction-id': trace,
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  })
  return unwrap<DisputeRecord>(res)
}
