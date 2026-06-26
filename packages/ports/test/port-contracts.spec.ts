import { describe, expect, it } from 'vitest'
import { PORT_NAMES, getAdapter, type PortName } from '../src/registry.js'
import { EnterpriseAdapterNotImplementedError } from '../src/types.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

/**
 * Port contract suite — binds ANY adapter behind the interface. Sim adapters run
 * now; the same expectations gate enterprise adapters at M6 (port-swap acceptance).
 */
function describePortContract(profile: 'demo') {
  describe(`port contracts (${profile} profile)`, () => {
    it('P1 mints care tokens with act+sub claims and ≤15 min expiry', async () => {
      const p1 = getAdapter('p1-care-surface', profile)
      const t = await p1.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)
      expect(t.act).toBe('agent-001')
      expect(t.sub).toBe('psu-001')
      expect(t.token).toBeTruthy()
      expect(new Date(t.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    })

    it('P2 verifies tokens with MFA and exposes the 9 demo personas', async () => {
      const p2 = getAdapter('p2-identity-provider', profile)
      const personas = await p2.personaLogins()
      expect(personas).toHaveLength(9)
      expect(personas.map((p) => p.persona)).toContain('platform-super-admin')
      expect(personas.map((p) => p.persona)).toContain('platform-admin')
      const claims = await p2.verifyToken(personas[0]!.demo_token)
      expect(claims.mfa).toBe(true)
      expect(claims.persona).toBe(personas[0]!.persona)
    })

    it('P2 mints + verifies an agent session token (ADR 0018) — round-trip carries the bound identity', async () => {
      const p2 = getAdapter('p2-identity-provider', profile)
      const minted = await p2.mintAgentSession(
        { agent_id: 'agent-abc', persona: 'care-readonly-agent', scopes: ['consents:admin', 'audit:read'], allow_mutations: true, spend_budget: 3 },
        trace
      )
      expect(minted.token).toMatch(/^agent-session\./)
      expect(minted.session_id).toBeTruthy()
      expect(new Date(minted.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)

      const verified = await p2.verifyAgentSession(minted.token)
      expect(verified).not.toBeNull()
      expect(verified!.agent_id).toBe('agent-abc')
      expect(verified!.persona).toBe('care-readonly-agent')
      expect(verified!.session_id).toBe(minted.session_id)
      expect(verified!.scopes).toEqual(['consents:admin', 'audit:read'])
      expect(verified!.allow_mutations).toBe(true)
      expect(verified!.spend_budget).toBe(3)
    })

    it('P2 returns null for a non-agent (human) bearer — the human OIDC path handles it', async () => {
      const p2 = getAdapter('p2-identity-provider', profile)
      expect(await p2.verifyAgentSession('demo-token:platform-admin')).toBeNull()
      expect(await p2.verifyAgentSession('not-a-token')).toBeNull()
    })

    it('P2 rejects a tampered agent session token (forged identity must not verify)', async () => {
      const p2 = getAdapter('p2-identity-provider', profile)
      const minted = await p2.mintAgentSession(
        { agent_id: 'agent-xyz', persona: 'care-readonly-agent', scopes: ['audit:read'], allow_mutations: false, spend_budget: 0 },
        trace
      )
      // Swap the payload for a forged one (claims an inflated budget + mutations) — the HMAC no longer matches.
      const forgedPayload = Buffer.from(
        JSON.stringify({ agent_id: 'agent-xyz', persona: 'care-readonly-agent', session_id: 's', scopes: ['consents:admin'], allow_mutations: true, spend_budget: 9999, exp: Date.now() + 60_000 }),
        'utf8'
      ).toString('base64url')
      const sig = minted.token.split('.')[2]
      const forged = `agent-session.${forgedPayload}.${sig}`
      await expect(p2.verifyAgentSession(forged)).rejects.toThrow()
    })

    it('P3 creates ITSM tickets with team routing', async () => {
      const p3 = getAdapter('p3-itsm', profile)
      const t = await p3.createTicket(
        { type: 'liability_threshold', severity: 'high', team: 'risk_compliance', summary: 'test' },
        trace
      )
      expect(t.ticket_id).toBeTruthy()
    })

    it('P4 reads balances as binding Money', async () => {
      const p4 = getAdapter('p4-core-banking', profile)
      const b = await p4.getBalance('acc-001', trace)
      expect(Number.isInteger(b.balance.amount)).toBe(true)
      expect(b.balance.currency).toMatch(/^[A-Z]{3}$/)
    })

    it('P5 accepts an OTel span batch', async () => {
      const p5 = getAdapter('p5-apm', profile)
      await expect(
        p5.exportSpans([
          {
            name: 'test-span',
            trace_id: trace.trace_id,
            span_id: 'span-001',
            start_time: 0,
            end_time: 1,
            status_code: 'ok',
            attributes: { 'http.route': '/test' }
          }
        ])
      ).resolves.toBeUndefined()
    })

    it('P6 acknowledges consent revocation within the 5s scheme SLA', async () => {
      const p6 = getAdapter('p6-nebras-egress', profile)
      const r = await p6.revokeConsent('consent-001', 'CLIENT_INSTRUCTION', trace)
      expect(r.acknowledged_in_ms).toBeLessThan(5000)
    })

    it('P6 creates dispute cases and syncs the directory deterministically', async () => {
      const p6 = getAdapter('p6-nebras-egress', profile)
      const d = await p6.createDisputeCase({ summary: 'fee variance' }, trace)
      expect(d.nebras_case_id).toBeTruthy()
      const dir1 = await p6.syncDirectory(trace)
      const dir2 = await p6.syncDirectory(trace)
      expect(dir1.participants.length).toBeGreaterThan(0)
      expect(dir1).toEqual(dir2) // deterministic for repeatable demos
    })

    it('P6 dispatches a refund via the Ozone Connect flow, returning an IPP status (BACKOFFICE-62)', async () => {
      const p6 = getAdapter('p6-nebras-egress', profile)
      const r = await p6.dispatchRefund('consent-001', { amount: 150000, currency: 'AED' }, trace)
      expect(['ACCC', 'ACSP', 'ACSC', 'RJCT', 'PDNG']).toContain(r.ipp_status)
    })

    it('P6 reports a consent status for drift checks (DEMO-01)', async () => {
      const p6 = getAdapter('p6-nebras-egress', profile)
      const r = await p6.getConsentStatus('consent-001', trace)
      expect(r.consent_id).toBe('consent-001')
      expect(typeof r.status).toBe('string')
      expect(r.status.length).toBeGreaterThan(0)
    })

    it('P7 accepts column-level lineage emission', async () => {
      const p7 = getAdapter('p7-lineage', profile)
      await expect(
        p7.emitLineage({ table: 'reconciliation_break', columns: ['variance_amount'], source: 'recon-engine', trace_id: trace.trace_id })
      ).resolves.toBeUndefined()
    })

    it('P8 yields funnel events with entry-path dimension', async () => {
      const p8 = getAdapter('p8-onboarding-handover', profile)
      const events = await p8.getFunnelEvents({ from: '2026-01-01', to: '2026-12-31' })
      expect(events.length).toBeGreaterThan(0)
      for (const e of events) expect(['DIRECT_SIGNUP', 'ONBOARDING_HANDOVER']).toContain(e.entry_path)
    })

    it('P9 registers counterparties and tracks settlement', async () => {
      const p9 = getAdapter('p9-financial-system', profile)
      const reg = await p9.registerCounterparty({ organisation_id: 'org-001', legal_name: 'Fictional Fintech FZ-LLC' }, trace)
      expect(reg.financial_system_ref).toBeTruthy()
      const status = await p9.getSettlementStatus(reg.financial_system_ref, trace)
      expect(['instructed', 'issued', 'settled', 'overdue', 'credit_noted']).toContain(status.invoice_status)
    })
  })
}

describePortContract('demo')

describe('enterprise adapters land port-by-port (M6)', () => {
  // Reference enterprise adapters (own suites: p2-entra.spec.ts, p3-servicenow.spec.ts) — these
  // resolve to a configured adapter instead of throwing NotImplemented. The rest remain stubs.
  const WIRED = new Set<PortName>(['p1-care-surface', 'p2-identity-provider', 'p3-itsm', 'p5-apm', 'p9-financial-system'])
  const STILL_STUB = PORT_NAMES.filter((p) => !WIRED.has(p))

  it.each(STILL_STUB.map((p) => [p] as const))('%s enterprise stub throws NotImplemented', (port: PortName) => {
    expect(() => getAdapter(port, 'enterprise')).toThrow(EnterpriseAdapterNotImplementedError)
  })

  it('p2-identity-provider is WIRED for enterprise — resolves with config, errors clearly without', () => {
    const saved = { ...process.env }
    try {
      delete process.env.P2_OIDC_ISSUER
      delete process.env.P2_OIDC_CLIENT_ID
      // Wired (not NotImplemented), but unconfigured → a clear config error, never the demo sim.
      expect(() => getAdapter('p2-identity-provider', 'enterprise')).toThrow(/P2 Entra adapter misconfigured/)

      process.env.P2_OIDC_ISSUER = 'https://login.microsoftonline.com/tenant/v2.0'
      process.env.P2_OIDC_CLIENT_ID = 'client-123'
      process.env.P2_PERSONA_MAPPING = JSON.stringify({ 'OFBO.Compliance': 'compliance-officer' })
      process.env.P2_AGENT_SIGNING_KEY = 'synthetic-test-signing-key-0123456789abcd'
      const p2 = getAdapter('p2-identity-provider', 'enterprise')
      expect(typeof p2.verifyToken).toBe('function')
      expect(typeof p2.mintAgentSession).toBe('function')
    } finally {
      process.env = saved
    }
  })

  it('p3-itsm is WIRED for enterprise — resolves with config, errors clearly without', () => {
    const saved = { ...process.env }
    try {
      delete process.env.P3_SERVICENOW_INSTANCE_URL
      delete process.env.P3_SERVICENOW_AUTH
      expect(() => getAdapter('p3-itsm', 'enterprise')).toThrow(/P3 ServiceNow adapter misconfigured/)

      process.env.P3_SERVICENOW_INSTANCE_URL = 'https://acme.service-now.com'
      process.env.P3_SERVICENOW_AUTH = 'Bearer test-token'
      process.env.P3_ASSIGNMENT_GROUP_MAP = JSON.stringify({ risk_compliance: 'grp-risk' })
      const p3 = getAdapter('p3-itsm', 'enterprise')
      expect(typeof p3.createTicket).toBe('function')
    } finally {
      process.env = saved
    }
  })

  it('p5-apm is WIRED for enterprise — resolves with config, errors clearly without', () => {
    const saved = { ...process.env }
    try {
      delete process.env.P5_OTLP_ENDPOINT
      expect(() => getAdapter('p5-apm', 'enterprise')).toThrow(/P5 OTLP APM adapter misconfigured/)

      process.env.P5_OTLP_ENDPOINT = 'https://otlp.vendor.example'
      const p5 = getAdapter('p5-apm', 'enterprise')
      expect(typeof p5.exportSpans).toBe('function')
    } finally {
      process.env = saved
    }
  })

  it('p9-financial-system (Kong Konnect) is WIRED for enterprise', () => {
    const saved = { ...process.env }
    try {
      delete process.env.P9_KONNECT_BASE_URL
      delete process.env.P9_KONNECT_AUTH
      expect(() => getAdapter('p9-financial-system', 'enterprise')).toThrow(/P9 Kong Konnect adapter misconfigured/)

      process.env.P9_KONNECT_BASE_URL = 'https://billing.konnect.example'
      process.env.P9_KONNECT_AUTH = 'Bearer k'
      expect(typeof getAdapter('p9-financial-system', 'enterprise').registerCounterparty).toBe('function')
    } finally {
      process.env = saved
    }
  })

  it('p1-care-surface (CRM) is WIRED for enterprise', () => {
    const saved = { ...process.env }
    try {
      delete process.env.P1_CRM_BASE_URL
      delete process.env.P1_CARE_TOKEN_SIGNING_KEY
      expect(() => getAdapter('p1-care-surface', 'enterprise')).toThrow(/P1 CRM care-surface adapter misconfigured/)

      process.env.P1_CRM_BASE_URL = 'https://acme.my.salesforce.com'
      process.env.P1_CRM_AUTH = 'Bearer sf'
      process.env.P1_CARE_TOKEN_SIGNING_KEY = 'synthetic-care-signing-key-0123456789abcd'
      expect(typeof getAdapter('p1-care-surface', 'enterprise').mintCareToken).toBe('function')
    } finally {
      process.env = saved
    }
  })
})

// M6 port-swap acceptance gate: when an enterprise adapter lands, it must pass
// EXACTLY the demo-profile suite above. Re-enable per port by calling
// describePortContract('enterprise') once getAdapter(port, 'enterprise') resolves.
