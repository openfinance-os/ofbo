import type { Money } from '../../types.js'
import type { NebrasEgressPort } from '../../interfaces.js'
import { NebrasEgressError } from '../sim.js'

/**
 * P6 — Nebras egress enterprise adapter (pre-staged per ADR 0024, fidelity rung ③).
 *
 * HARD STOP (CLAUDE.md, non-negotiable): ALL Nebras-bound traffic rides the bank's egress
 * gateway — no direct egress. This adapter therefore calls the bank's EGRESS GATEWAY, never
 * Nebras directly; the gateway holds the FAPI 2.0 mTLS + PAR/PKCE + scheme certificate chain
 * (CLAUDE.md: "scheme certificate chain handled by the egress gateway (P6)"), so the adapter
 * is a plain service-to-service authenticated HTTP client. The route shapes mirror the Nebras
 * API Hub surfaces the sim already establishes (TPP Reports, Dataset, Consent Manager, Case &
 * Dispute Management, Ozone Connect refund) — the port-swap acceptance gate is that this
 * adapter passes EXACTLY the P6 contract the sim passes.
 *
 * Implements EXACTLY the P6 port contract — nothing more (ADR 0024 guardrail 1). The gateway
 * URL + auth are config / Bank Profile (guardrail 3). Transport is injectable; with no gateway
 * URL is mandatory (fail-closed); tests inject a fake gateway with deterministic responses, so the
 * contract runs the real build→call→parse path with no backend (guardrail 4 / rung ②). The
 * real gateway/mTLS/Nebras connectivity is the M6 swap (rung ④).
 */

export interface NebrasEgressConfig {
  /** Bank Profile — the enterprise EGRESS GATEWAY base URL (P6). The adapter NEVER calls
   *  Nebras directly. Mandatory — fail-closed (tests inject a fake `fetchImpl`). */
  egressGatewayUrl?: string
  /** Bank Profile — service-to-service token provider (OAuth2 client_credentials) for the
   *  egress gateway. Mandatory — fail-closed. */
  getToken?: (trace: { trace_id: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

export function createNebrasEgressAdapter(config: NebrasEgressConfig = {}): NebrasEgressPort {
  // FAIL-CLOSED: a fake egress gateway under DEPLOY_PROFILE=enterprise would mean unrouted
  // Nebras traffic — so the gateway URL + token are mandatory, never defaulted to a fake.
  if (!config.egressGatewayUrl) throw new NebrasEgressError(0, false, 'egress gateway URL is required (fail-closed — no fake gateway under the enterprise profile)')
  if (!config.getToken) throw new NebrasEgressError(0, false, 'egress gateway getToken is required')
  const getToken = config.getToken
  const base = config.egressGatewayUrl
  const doFetch = config.fetchImpl ?? globalThis.fetch

  async function call(path: string, trace: { trace_id: string }, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // x-fapi-interaction-id propagated end-to-end (the gateway forwards it to Nebras).
      'x-fapi-interaction-id': trace.trace_id,
      authorization: `Bearer ${await getToken(trace)}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {})
    }
    return doFetch(`${base}${path}`, { ...init, headers })
  }

  /** Read JSON or throw the shared NebrasEgressError (429/5xx retryable → ingestion back-off). */
  async function readJson<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new NebrasEgressError(res.status, res.status === 429 || res.status >= 500, `Nebras egress ${what} → ${res.status}`)
    return (await res.json()) as T
  }

  return {
    async revokeConsent(consentId, reason, trace) {
      const res = await call(`/consent-manager/consents/${encodeURIComponent(consentId)}/revoke`, trace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      return readJson<{ acknowledged_in_ms: number }>(res, 'revoke')
    },
    async fetchTppReports(period, trace) {
      const res = await call(`/tpp-reports/${encodeURIComponent(period)}`, trace)
      return readJson<{ published_at: string; rows: Record<string, unknown>[] }>(res, 'tpp-reports')
    },
    async fetchDataset(name, period, trace) {
      const res = await call(`/datasets/${encodeURIComponent(name)}/${encodeURIComponent(period)}`, trace)
      return readJson<{ published_at: string; rows: Record<string, unknown>[] }>(res, 'dataset')
    },
    async createDisputeCase(payload, trace) {
      const res = await call('/case-management/disputes', trace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      return readJson<{ nebras_case_id: string }>(res, 'dispute')
    },
    async syncDirectory(trace) {
      const res = await call('/directory', trace)
      return readJson<{ participants: { organisation_id: string; legal_name: string }[] }>(res, 'directory')
    },
    async dispatchRefund(consentId: string, amount: Money, trace) {
      const res = await call(`/payment-consents/${encodeURIComponent(consentId)}/refund`, trace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount })
      })
      return readJson<{ ipp_status: string }>(res, 'refund')
    },
    async getConsentStatus(consentId, trace) {
      const res = await call(`/consent-manager/consents/${encodeURIComponent(consentId)}`, trace)
      return readJson<{ consent_id: string; status: string }>(res, 'consent-status')
    }
  }
}

/** Build from the Bank Profile in the environment. FAIL-CLOSED: throws unless
 *  EGRESS_GATEWAY_URL and EGRESS_GATEWAY_TOKEN are set (a fake egress gateway under the
 *  enterprise profile would mean Nebras traffic goes nowhere). */
export function nebrasEgressFromEnv(env: NodeJS.ProcessEnv = process.env): NebrasEgressPort {
  const token = env.EGRESS_GATEWAY_TOKEN
  if (!env.EGRESS_GATEWAY_URL || !token) {
    throw new NebrasEgressError(0, false, 'Nebras egress adapter misconfigured: set EGRESS_GATEWAY_URL and EGRESS_GATEWAY_TOKEN')
  }
  return createNebrasEgressAdapter({
    egressGatewayUrl: env.EGRESS_GATEWAY_URL,
    getToken: async () => token
  })
}
