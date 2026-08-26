/**
 * BACKOFFICE-63 — STR (Suspicious Transaction Report) draft data layer. Calls the Hono BFF
 * over the OpenAPI contract path, SERVER-SIDE only (Bearer from the httpOnly cookie, never in
 * the browser). compliance:reports:read gates the screen; the BFF re-enforces. Read-only — the
 * handoff to the bank's STR workflow is four-eyes and initiated from the approvals surface, not
 * inline. Behaviour/data = the contract; appearance = the Stitch design. NO PSU PII — a draft
 * carries an internal consent ref + case context, never PSU identifiers.
 */
import { bffClient } from './bff'
import type { Schemas, KeysConformToContract, AssertContract } from './contract-types'

/** Mirrors the OpenAPI StrDraft wire shape. */
export interface StrDraft {
  str_draft_id: string
  source_consent_id: string
  case_context: string
  status: string
  created_by: string
  approval_id: string | null
  workflow_ref: string | null
  approved_by: string | null
  handed_off_at: string | null
  created_at: string
}

export class StrDraftsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface StrDraftsApiDeps {
  baseUrl?: string
  fetchImpl?: typeof fetch
  traceId?: string
}

export const STR_DRAFTS_PATH = '/back-office/str-drafts'

function resolve(deps: StrDraftsApiDeps) {
  return { ...bffClient(deps), trace: deps.traceId ?? crypto.randomUUID() }
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** BACKOFFICE-63 — STR drafts awaiting Compliance review / handoff (compliance:reports:read). */
export async function listStrDrafts(
  token: string,
  query: { cursor?: string; limit?: number; status?: string } = {},
  deps: StrDraftsApiDeps = {}
): Promise<{ drafts: StrDraft[]; next_cursor: string | null }> {
  const { base, f, trace } = resolve(deps)
  const res = await f(`${base}${STR_DRAFTS_PATH}${qs({ cursor: query.cursor, limit: query.limit, status: query.status })}`, {
    headers: { authorization: `Bearer ${token}`, 'x-fapi-interaction-id': trace }
  })
  const body = (await res.json().catch(() => ({}))) as {
    data?: StrDraft[]
    error?: { code?: string; message?: string }
    meta?: { next_cursor?: string | null }
  }
  if (!res.ok) {
    throw new StrDraftsApiError(body.error?.code ?? 'BACKOFFICE.ERROR', body.error?.message ?? `HTTP ${res.status}`, res.status)
  }
  return { drafts: body.data ?? [], next_cursor: body.meta?.next_cursor ?? null }
}

// ADR-0004 drift guard — fail typecheck if the contract renames/removes a field this view reads.
export type StrDraftContractGuard = AssertContract<KeysConformToContract<StrDraft, Schemas['StrDraft']>>
