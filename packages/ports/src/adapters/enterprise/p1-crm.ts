import type { CareSurfacePort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P1 enterprise adapter — CRM-resident customer-care surface (Salesforce Service Cloud / Microsoft
 * Dynamics). Follows the ADR 0023 pattern.
 *  • mintCareToken issues a short-lived, HMAC-signed token binding act (agent) + sub (PSU) with a
 *    ≤15-min expiry — the scoped context an agent carries into the CRM-resident console.
 *  • resolveCallRecording LINKS, never copies: it resolves a short-lived locator into the bank's
 *    contact-centre system (Salesforce Service Cloud Voice / Dynamics Omnichannel) and returns the
 *    reference (+ a short-lived URL when one is available), or null when nothing is on file.
 *
 * The recording lookup HTTP transport is an injected seam (fetchCrmHttp default; tests inject a
 * fake — no network, no new dependency). No PSU PII crosses into OFBO storage — only the opaque
 * recording reference + a short-lived link.
 */

const CARE_TOKEN_PREFIX = 'care-token.'
const CARE_TOKEN_TTL_MS = 15 * 60_000

export type CrmVendor = 'salesforce' | 'dynamics'

export interface CrmHttp {
  get(path: string, trace: TraceContext): Promise<{ status: number; json: unknown }>
}

export interface CrmCareConfig {
  vendor: CrmVendor
  /** HMAC key for the care token (the bank's care-context signing secret). */
  signingKey: string
  crm: CrmHttp
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

interface RecordingResponse {
  id?: string
  recording_ref?: string
  recording_url?: string | null
  result?: { id?: string; recording_url?: string | null }
}

export class CrmCareSurfaceAdapter implements CareSurfacePort {
  constructor(private readonly cfg: CrmCareConfig) {}

  private key() {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(this.cfg.signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  }

  async mintCareToken(
    input: { agent_id: string; psu_id: string },
    _trace: TraceContext
  ): Promise<{ token: string; act: string; sub: string; expires_at: string }> {
    const exp = Date.now() + CARE_TOKEN_TTL_MS
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ act: input.agent_id, sub: input.psu_id, exp })))
    const body = CARE_TOKEN_PREFIX + payload
    const sig = await crypto.subtle.sign('HMAC', await this.key(), new TextEncoder().encode(body))
    return {
      token: `${body}.${b64url(sig)}`,
      act: input.agent_id,
      sub: input.psu_id,
      expires_at: new Date(exp).toISOString()
    }
  }

  async resolveCallRecording(
    input: { call_id: string },
    trace: TraceContext
  ): Promise<{ recording_ref: string; recording_url: string | null; expires_at: string } | null> {
    if (!input.call_id) return null
    const path =
      this.cfg.vendor === 'dynamics'
        ? `/api/data/v9.2/voicecalls(${encodeURIComponent(input.call_id)})`
        : `/services/data/v60.0/sobjects/VoiceCall/${encodeURIComponent(input.call_id)}`
    const res = await this.cfg.crm.get(path, trace)
    if (res.status === 404) return null // nothing on file
    if (res.status < 200 || res.status >= 300) throw new Error(`P1: CRM recording lookup failed (HTTP ${res.status})`)
    const r = res.json as RecordingResponse
    const recording_ref = r.recording_ref ?? r.id ?? r.result?.id
    if (!recording_ref) return null
    return {
      recording_ref,
      recording_url: r.recording_url ?? r.result?.recording_url ?? null, // link, never copy
      expires_at: new Date(Date.now() + CARE_TOKEN_TTL_MS).toISOString()
    }
  }
}

// ── fetch-backed transport (production default) ──────────────────────────────────────────────

export function fetchCrmHttp(baseUrl: string, authHeader: string): CrmHttp {
  const base = baseUrl.replace(/\/$/, '')
  return {
    async get(path, trace) {
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: { authorization: authHeader, accept: 'application/json', 'x-fapi-interaction-id': trace.trace_id }
      })
      return { status: res.status, json: await res.json().catch(() => ({})) }
    }
  }
}

// ── Env factory ──────────────────────────────────────────────────────────────────────────────

export class CrmCareConfigError extends Error {
  constructor(message: string) {
    super(`P1 CRM care-surface adapter misconfigured: ${message}`)
    this.name = 'CrmCareConfigError'
  }
}

/** Construct from configuration. Required: P1_CRM_BASE_URL, P1_CRM_AUTH (full Authorization header),
 *  P1_CARE_TOKEN_SIGNING_KEY (≥32 chars). Optional: P1_CRM_VENDOR (salesforce|dynamics, default
 *  salesforce). */
export function crmCareFromEnv(env: Record<string, string | undefined>): CrmCareSurfaceAdapter {
  const baseUrl = env.P1_CRM_BASE_URL
  if (!baseUrl) throw new CrmCareConfigError('P1_CRM_BASE_URL is required (the CRM instance base URL)')
  const auth = env.P1_CRM_AUTH
  if (!auth) throw new CrmCareConfigError('P1_CRM_AUTH is required (a full Authorization header)')
  const signingKey = env.P1_CARE_TOKEN_SIGNING_KEY
  if (!signingKey) throw new CrmCareConfigError('P1_CARE_TOKEN_SIGNING_KEY is required (the care-token signing secret)')
  if (signingKey.length < 32) throw new CrmCareConfigError('P1_CARE_TOKEN_SIGNING_KEY must be ≥32 chars of high-entropy secret')

  const vendorRaw = (env.P1_CRM_VENDOR ?? 'salesforce').toLowerCase()
  if (vendorRaw !== 'salesforce' && vendorRaw !== 'dynamics') {
    throw new CrmCareConfigError('P1_CRM_VENDOR must be "salesforce" or "dynamics"')
  }

  return new CrmCareSurfaceAdapter({ vendor: vendorRaw, signingKey, crm: fetchCrmHttp(baseUrl, auth) })
}
