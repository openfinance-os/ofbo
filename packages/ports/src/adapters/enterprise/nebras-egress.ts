import type { Money } from '../../types.js'
import type { NebrasEgressPort } from '../../interfaces.js'
import { NebrasEgressError } from '../sim.js'

/**
 * P6 — Nebras egress enterprise adapter (pre-staged per ADR 0023, fidelity rung ③).
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
 * Implements EXACTLY the P6 port contract — nothing more (ADR 0023 guardrail 1). The gateway
 * URL + auth are config / Bank Profile (guardrail 3). Transport is injectable; with no gateway
 * URL configured it binds an in-memory fake gateway with deterministic responses, so the
 * contract runs the real build→call→parse path with no backend (guardrail 4 / rung ②). The
 * real gateway/mTLS/Nebras connectivity is the M6 swap (rung ④).
 */

export interface NebrasEgressConfig {
  /** Bank Profile — the enterprise EGRESS GATEWAY base URL (P6). The adapter NEVER calls
   *  Nebras directly. When unset, the in-memory fake gateway is used (contract/test context). */
  egressGatewayUrl?: string
  /** Bank Profile — service-to-service token provider (OAuth2 client_credentials) for the
   *  egress gateway. Required once the URL is set; unused on the fake path. */
  getToken?: (trace: { trace_id: string }) => Promise<string>
  /** Injectable transport (defaults to global fetch on the real path). */
  fetchImpl?: typeof fetch
}

const FAKE_GATEWAY = 'https://fake.egress-gateway.invalid'

const FAKE_DIRECTORY = [
  { organisation_id: 'org-fictional-fintech-01', legal_name: 'Fictional Fintech One FZ-LLC' },
  { organisation_id: 'org-fictional-fintech-02', legal_name: 'Fictional Fintech Two Ltd' }
]

/** Deterministic in-memory egress gateway — emulates the gateway's forwarding of the Nebras
 *  API Hub surfaces, so the adapter's real request/parse path runs with no backend (rung ②).
 *  Deterministic responses (fixed directory, fixed ack) keep the contract repeatable. */
const fakeGatewayFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init?.method ?? 'GET'
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  if (/\/consent-manager\/consents\/[^/]+\/revoke$/.test(url) && method === 'POST') return json({ acknowledged_in_ms: 300 })
  if (/\/consent-manager\/consents\/[^/]+$/.test(url) && method === 'GET') {
    const id = decodeURIComponent(url.split('/').pop()!.split('?')[0]!)
    return json({ consent_id: id, status: 'Authorized' })
  }
  if (/\/tpp-reports\//.test(url)) return json({ published_at: '2026-06-28T00:00:00.000Z', rows: [] })
  if (/\/datasets\//.test(url)) return json({ published_at: '2026-06-28T00:00:00.000Z', rows: [] })
  if (/\/case-management\/disputes$/.test(url) && method === 'POST') return json({ nebras_case_id: 'nebras-case-000001' })
  if (/\/directory$/.test(url)) return json({ participants: FAKE_DIRECTORY })
  if (/\/payment-consents\/[^/]+\/refund$/.test(url)) return json({ ipp_status: 'ACSP' })
  return json({ error: 'unhandled egress route' }, 404)
}

export function createNebrasEgressAdapter(config: NebrasEgressConfig = {}): NebrasEgressPort {
  const real = Boolean(config.egressGatewayUrl)
  const base = config.egressGatewayUrl ?? FAKE_GATEWAY
  const doFetch = config.fetchImpl ?? (real ? globalThis.fetch : fakeGatewayFetch)

  async function call(path: string, trace: { trace_id: string }, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // x-fapi-interaction-id propagated end-to-end (the gateway forwards it to Nebras).
      'x-fapi-interaction-id': trace.trace_id,
      ...((init?.headers as Record<string, string> | undefined) ?? {})
    }
    if (real) {
      if (!config.getToken) throw new NebrasEgressError(0, false, 'egress gateway getToken is required when egressGatewayUrl is set')
      headers.authorization = `Bearer ${await config.getToken(trace)}`
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

/** Build from the Bank Profile in the environment. With no EGRESS_GATEWAY_URL set, binds the
 *  fake gateway (contract/test context). */
export function nebrasEgressFromEnv(env: NodeJS.ProcessEnv = process.env): NebrasEgressPort {
  const token = env.EGRESS_GATEWAY_TOKEN
  return createNebrasEgressAdapter({
    egressGatewayUrl: env.EGRESS_GATEWAY_URL,
    getToken: token ? async () => token : undefined
  })
}
