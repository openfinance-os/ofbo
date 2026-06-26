import type { CareSurfacePort } from '../../interfaces.js'
import type { TraceContext } from '../../types.js'

/**
 * P1 — Salesforce Service Cloud care-surface enterprise adapter (pre-staged per ADR 0024,
 * fidelity rung ③). The CRM-resident care console alternative (PRD §3 P1).
 *
 * Implements EXACTLY the P1 port contract (`mintCareToken`, `resolveCallRecording`) —
 * nothing more (ADR 0024 guardrail 1). Bank-specifics — Salesforce instance, the
 * token-exchange endpoint, the connected-app bearer, the recording object — are
 * configuration / Bank Profile (guardrail 3), never hardcoded.
 *
 * - mintCareToken: RFC 8693 OAuth token exchange (ADR 0001) — actor_token = agent,
 *   subject_token = PSU — against the bank's enterprise-SSO / connected-app token URL,
 *   yielding a short-lived (≤15 min, regulatory ceiling) care token carrying act+sub.
 * - resolveCallRecording: resolves a contact-centre call id to a short-lived locator into
 *   Service Cloud Voice — the Back Office LINKS, never copies (ADR 0003); null when no
 *   recording is on file (e.g. a non-voice channel).
 *
 * Transport is injectable; with no instance/token URL configured the adapter binds an
 * fake transport (injected in tests) so the contract runs the real build→call→parse path with no tenant
 * (guardrail 4 / rung ②). The tenant/connected-app/residency mile is the M6 swap (rung ④).
 */

/** Regulatory ceiling on care-token lifetime (ADR 0001 / BACKOFFICE-25): ≤15 minutes. */
const CARE_TOKEN_TTL_CEILING_MS = 15 * 60_000
const RECORDING_LOCATOR_TTL_MS = 15 * 60_000
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'

export interface SalesforceCareConfig {
  /** Bank Profile — Salesforce instance / My Domain base, e.g. `https://acme.my.salesforce.com`. */
  instanceUrl?: string
  /** Salesforce REST API version for recording lookups (default `v60.0`). */
  apiVersion?: string
  /** Bank Profile — RFC 8693 token-exchange endpoint that mints the ≤15-min care token
   *  with act+sub (the connected-app / enterprise-SSO token URL). Fail-closed; tests inject a fake
   *  token path is used (contract/test context). */
  tokenExchangeUrl?: string
  /** Bank Profile — connected-app bearer provider for Salesforce recording lookups.
   *  Mandatory — fail-closed. */
  getToken?: (trace: TraceContext) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

/** Thrown on a non-2xx from Salesforce / the token endpoint (404 on a recording lookup is
 *  NOT an error — it means "no recording", returned as null). `retryable` on 429/5xx. */
export class SalesforceCareError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
    this.name = 'SalesforceCareError'
  }
}

export function createSalesforceCareSurfaceAdapter(config: SalesforceCareConfig = {}): CareSurfacePort {
  // FAIL-CLOSED: no silent fake — each method requires the config it uses (the fail-closed
  // env gate is salesforceCareSurfaceFromEnv). Transport is injectable for tests.
  const apiVersion = config.apiVersion ?? 'v60.0'
  const doFetch = config.fetchImpl ?? globalThis.fetch

  return {
    async mintCareToken({ agent_id, psu_id }, trace) {
      if (!config.tokenExchangeUrl) throw new SalesforceCareError(0, false, 'Salesforce tokenExchangeUrl is required to mint a care token')
      const tokenUrl = config.tokenExchangeUrl
      // RFC 8693 token exchange: actor (agent) acting for subject (PSU). ADR 0001.
      const body = new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: psu_id,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        actor_token: agent_id,
        actor_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token'
      })
      const res = await doFetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-fapi-interaction-id': trace.trace_id },
        body: body.toString()
      })
      if (!res.ok) {
        throw new SalesforceCareError(res.status, res.status === 429 || res.status >= 500, `care token exchange → ${res.status}`)
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number }
      if (!data.access_token) throw new SalesforceCareError(res.status, false, 'token exchange response missing access_token')
      const ttlMs = (data.expires_in ?? 0) * 1000
      // Enforce the ≤15-min regulatory ceiling: a connected app issuing a longer-lived care
      // token is a Bank-Profile misconfiguration, not something to silently mask.
      if (ttlMs <= 0 || ttlMs > CARE_TOKEN_TTL_CEILING_MS) {
        throw new SalesforceCareError(res.status, false, `care token TTL ${ttlMs}ms violates the ≤15-min ceiling (ADR 0001) — check connected-app config`)
      }
      return { token: data.access_token, act: agent_id, sub: psu_id, expires_at: new Date(Date.now() + ttlMs).toISOString() }
    },

    async resolveCallRecording({ call_id }, trace) {
      if (!call_id) return null // non-voice channel / no call — null, never an error (ADR 0003)
      if (!config.instanceUrl) throw new SalesforceCareError(0, false, 'Salesforce instanceUrl is required to resolve a recording')
      if (!config.getToken) throw new SalesforceCareError(0, false, 'Salesforce getToken (connected-app bearer) is required')
      const res = await doFetch(`${config.instanceUrl}/services/data/${apiVersion}/sobjects/VoiceCall/CallSid/${encodeURIComponent(call_id)}`, {
        headers: {
          accept: 'application/json',
          'x-fapi-interaction-id': trace.trace_id,
          authorization: `Bearer ${await config.getToken(trace)}`
        }
      })
      if (res.status === 404) return null // no recording on file
      if (!res.ok) {
        throw new SalesforceCareError(res.status, res.status === 429 || res.status >= 500, `recording lookup → ${res.status}`)
      }
      const rec = (await res.json()) as { Id?: string; RecordingUrl?: string }
      if (!rec.Id) return null
      // Link, never copy: a short-lived locator into Service Cloud Voice (ADR 0003).
      return {
        recording_ref: rec.Id,
        recording_url: rec.RecordingUrl ?? null,
        expires_at: new Date(Date.now() + RECORDING_LOCATOR_TTL_MS).toISOString()
      }
    }
  }
}

/** Build the adapter from the Bank Profile in the environment. FAIL-CLOSED: throws unless
 *  SALESFORCE_INSTANCE_URL, SALESFORCE_TOKEN_EXCHANGE_URL and SALESFORCE_BEARER_TOKEN are all
 *  set (never a silent fake under the enterprise profile). SALESFORCE_BEARER_TOKEN is a rung-②
 *  stand-in for the real connected-app provider wired at the M6 sandbox swap. */
export function salesforceCareSurfaceFromEnv(env: NodeJS.ProcessEnv = process.env): CareSurfacePort {
  const bearer = env.SALESFORCE_BEARER_TOKEN
  if (!env.SALESFORCE_INSTANCE_URL || !env.SALESFORCE_TOKEN_EXCHANGE_URL || !bearer) {
    throw new SalesforceCareError(0, false, 'Salesforce adapter misconfigured: set SALESFORCE_INSTANCE_URL, SALESFORCE_TOKEN_EXCHANGE_URL and SALESFORCE_BEARER_TOKEN')
  }
  return createSalesforceCareSurfaceAdapter({
    instanceUrl: env.SALESFORCE_INSTANCE_URL,
    apiVersion: env.SALESFORCE_API_VERSION,
    tokenExchangeUrl: env.SALESFORCE_TOKEN_EXCHANGE_URL,
    getToken: async () => bearer
  })
}
