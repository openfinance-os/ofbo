/**
 * HARNESS-10 — the rung-② bench that lets the ENTERPRISE adapters be driven by the SAME port
 * contract suite the simulators pass (CLAUDE.md: "an enterprise adapter must pass exactly the
 * tests the simulator passes — that is the port-swap acceptance gate, M6").
 *
 * Until now that gate was inert: `describePortContract` was literally typed `profile: 'demo'`
 * and never invoked for anything else, so the promise was carried by a comment.
 *
 * What this bench is, precisely — and what it is NOT:
 *   • IS: every enterprise adapter constructed from Bank-Profile-shaped config, driven through
 *     its REAL request-build → transport → response-parse path, against a fake vendor that
 *     returns vendor-shaped payloads. That exercises the mapping code an M6 swap depends on.
 *   • IS NOT: proof against a live tenant. Auth, residency, rate limits and real payload drift
 *     are the M6 rung-④ mile and cannot be simulated honestly here.
 * Calling that difference out is the point: a bench that quietly claimed more than it tests
 * would be the same failure class (HARNESS-07) this work exists to close.
 *
 * The vendor payloads below are the ones each adapter's own spec already pins, so the bench
 * cannot drift into asserting a shape the adapter does not actually parse.
 */
import { vi } from 'vitest'
import type { PortName } from '../../src/registry.js'
import type { PortMap } from '../../src/interfaces.js'
import { createSalesforceCareSurfaceAdapter } from '../../src/adapters/enterprise/salesforce-care-surface.js'
import { entraIdpFromEnv } from '../../src/adapters/enterprise/p2-entra.js'
import { createServiceNowItsmAdapter } from '../../src/adapters/enterprise/servicenow-itsm.js'
import { createCoreBankingAdapter } from '../../src/adapters/enterprise/core-banking.js'
import { createOtlpApmAdapter } from '../../src/adapters/enterprise/otlp-apm.js'
import { createNebrasEgressAdapter } from '../../src/adapters/enterprise/nebras-egress.js'
import { createOpenLineageAdapter } from '../../src/adapters/enterprise/openlineage.js'
import { createOnboardingHandoverAdapter } from '../../src/adapters/enterprise/onboarding-handover.js'
import { createFinancialSystemAdapter } from '../../src/adapters/enterprise/financial-system.js'
import { createStrWorkflowAdapter } from '../../src/adapters/enterprise/str-workflow.js'
import { createEInvoicingAspAdapter } from '../../src/adapters/enterprise/einvoicing-asp.js'

/** Route a fake vendor response by URL substring. First match wins; `fallback` covers the rest. */
function routedFetch(routes: Array<[match: string, body: unknown, status?: number]>, fallback: unknown = { ok: true }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    const hit = routes.find(([m]) => u.includes(m))
    const [, body, status] = hit ?? [undefined, fallback, 200]
    return new Response(JSON.stringify(body), {
      status: status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
}

/**
 * P9's payable routes, which `routedFetch` cannot serve because they are STATEFUL.
 *
 * The port contract requires a retried dispatch to report `replayed: true` with the same
 * `dispatch_ref`, and that guarantee belongs to the vendor's own idempotency-key dedupe — the
 * adapter only surfaces it. A fake returning a fixed body would make the enterprise side pass the
 * replay assertion while proving nothing about it, so this models the dedupe instead.
 *
 * Order matters here too: `/payables/{ref}/status` must be answered before the bare `/payables`
 * POST route and before P9's `/status` route, which it would otherwise match.
 */
function financialSystemFetch(): typeof fetch {
  const dispatched = new Map<string, string>()
  const base = routedFetch([
    ['/counterparties', { financial_system_ref: 'fms-org-001' }],
    ['/status', { invoice_status: 'issued' }],
    ['/journal-batches', { accepted: true, journal_batch_ref: 'GL-BATCH-2026-06' }],
    ['/invoice-runs', { accepted: true }]
  ])
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/payables/') && u.endsWith('/status')) {
      return json({ payable_status: 'presented' })
    }
    if (u.includes('/payables')) {
      const key = new Headers(init?.headers).get('idempotency-key') ?? ''
      const existing = dispatched.get(key)
      if (existing) return json({ accepted: true, dispatch_ref: existing, payable_status: 'dispatched', replayed: true })
      const ref = `fms-pay-${dispatched.size + 1}`
      dispatched.set(key, ref)
      return json({ accepted: true, dispatch_ref: ref, payable_status: 'dispatched', replayed: false })
    }
    return (base as unknown as (u: string | URL | Request, i?: RequestInit) => Promise<Response>)(url, init)
  }) as unknown as typeof fetch
}

const token = async () => 'bench-token'

/**
 * P2 is the exception: it is configured from env (its JWKS verifier and HMAC agent-token
 * service are built by `entraIdpFromEnv`). The agent-session contract is OFBO's own HMAC and
 * runs fully here; `verifyToken`/`personaLogins` need a live JWKS + real Entra tenant, so the
 * contract suite marks those demo-only rather than faking a token issuer.
 */
function entraWithBenchEnv(): PortMap['p2-identity-provider'] {
  return entraIdpFromEnv({
    P2_OIDC_ISSUER: 'https://login.microsoftonline.com/bench-tenant/v2.0',
    P2_OIDC_CLIENT_ID: 'bench-client',
    P2_PERSONA_MAPPING: JSON.stringify({ 'OFBO.Compliance': 'compliance-officer' }),
    // Synthetic, test-only signing key — never a real secret (no PII, no live credential).
    P2_AGENT_SIGNING_KEY: 'synthetic-bench-signing-key-0123456789abcdef'
  })
}

/** All ten enterprise adapters, configured and transport-faked. */
export function buildEnterpriseBench(): { [K in PortName]: PortMap[K] } {
  return {
    'p1-care-surface': createSalesforceCareSurfaceAdapter({
      tokenExchangeUrl: 'https://acme.my.salesforce.com/services/oauth2/token',
      instanceUrl: 'https://acme.my.salesforce.com',
      getToken: token,
      fetchImpl: routedFetch([
        ['oauth2/token', { access_token: 'care-tok', expires_in: 900 }],
        ['VoiceCall', { Id: '0LQabc', RecordingUrl: 'https://acme.my.salesforce.com/lightning/r/VoiceCall/0LQabc/view' }]
      ])
    }),

    'p2-identity-provider': entraWithBenchEnv(),

    'p3-itsm': createServiceNowItsmAdapter({
      instanceUrl: 'https://acme.service-now.com',
      table: 'incident',
      getToken: token,
      fetchImpl: routedFetch([['/api/now/table/', { result: { number: 'INC0042001', sys_id: 'sys-1' } }]])
    }),

    'p4-core-banking': createCoreBankingAdapter({
      baseUrl: 'https://core.bank.example',
      getToken: token,
      fetchImpl: routedFetch([
        ['/balance', { amount: 1_500_000, currency: 'AED', as_of: '2026-06-26T00:00:00.000Z' }],
        ['/transactions', [{ ref: 'tx-1', amount: -25_000, currency: 'AED', booked_at: '2026-06-01T08:00:00Z' }]]
      ])
    }),

    'p5-apm': createOtlpApmAdapter({
      endpoint: 'https://otlp.bank.example/v1/traces',
      serviceName: 'ofbo-bff',
      fetchImpl: routedFetch([], { partialSuccess: {} })
    }),

    'p6-nebras-egress': createNebrasEgressAdapter({
      egressGatewayUrl: 'https://egress.bank.example',
      getToken: token,
      fetchImpl: routedFetch([
        ['revoke', { acknowledged_in_ms: 280 }],
        ['/case-management/disputes', { nebras_case_id: 'nc-1' }],
        ['/directory', { participants: [{ organisation_id: 'o1', legal_name: 'L1' }] }],
        ['/refund', { ipp_status: 'ACSP' }],
        ['/tpp-reports/', { published_at: '2026-06-28T00:00:00.000Z', rows: [{ a: 1 }] }],
        ['/datasets/', { published_at: '2026-06-28T00:00:00.000Z', rows: [] }],
        ['/consents/', { consent_id: 'consent-001', status: 'Authorised' }]
      ])
    }),

    'p7-lineage': createOpenLineageAdapter({
      endpoint: 'https://marquez.bank.example',
      namespace: 'ofbo',
      datasetNamespace: 'ofbo-pg',
      fetchImpl: routedFetch([], {})
    }),

    'p8-onboarding-handover': createOnboardingHandoverAdapter({
      baseUrl: 'https://onboarding.bank.example',
      getToken: token,
      fetchImpl: routedFetch([
        ['/funnel-events', [{ entry_path: 'ONBOARDING_HANDOVER', stage: 'activated', at: '2026-06-03T12:00:00Z' }]],
        [
          '/onboarding-cases',
          [
            {
              case_id: 'ob-1',
              entry_path: 'DIRECT_SIGNUP',
              reached_stages: ['initiated'],
              abandoned_at_stage: 'initiated',
              started_at: '2026-06-01T00:00:00Z',
              activated_at: null,
              cross_sell: false
            }
          ]
        ]
      ])
    }),

    'p9-financial-system': createFinancialSystemAdapter({
      baseUrl: 'https://fms.bank.example',
      getToken: token,
      // Stateful: the BILL-16 payable routes model the vendor's idempotency-key dedupe, which the
      // replay assertion in the contract suite is actually about. See financialSystemFetch.
      fetchImpl: financialSystemFetch()
    }),

    'p10-str-workflow': createStrWorkflowAdapter({
      baseUrl: 'https://str.bank.example',
      getToken: token,
      fetchImpl: routedFetch([['/str-drafts', { workflow_ref: 'STR-WF-2026-001', accepted_at: '2026-07-04T00:00:00.000Z' }]])
    }),

    'p11-einvoicing-asp': createEInvoicingAspAdapter({
      baseUrl: 'https://einvoicing.bank.example',
      getToken: token,
      fetchImpl: routedFetch([['/pint-ae/documents', {
        accepted: true,
        submission_ref: 'ASP-INV-2026-06-TPP-A',
        document_status: 'accepted',
        tdd_status: 'reported'
      }]])
    })
  }
}
