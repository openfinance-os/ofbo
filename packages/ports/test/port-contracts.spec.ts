import { describe, expect, it } from 'vitest'
import { PORT_NAMES, getAdapter, type PortName } from '../src/registry.js'
import { EnterpriseAdapterNotImplementedError, type DeployProfile } from '../src/types.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

/** The P1 mint-care-token contract, factored out so the SAME assertions bind both the demo
 *  sim and the pre-staged Salesforce enterprise adapter (ADR 0023 — port-swap acceptance). */
async function assertP1Contract(profile: DeployProfile) {
  const p1 = getAdapter('p1-care-surface', profile)
  const t = await p1.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)
  expect(t.act).toBe('agent-001')
  expect(t.sub).toBe('psu-001')
  expect(t.token).toBeTruthy()
  expect(new Date(t.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
}

/** The P3 contract, factored out so the SAME assertions bind both the demo sim and the
 *  pre-staged ServiceNow enterprise adapter (ADR 0023 — the port-swap acceptance gate). */
async function assertP3Contract(profile: DeployProfile) {
  const p3 = getAdapter('p3-itsm', profile)
  const t = await p3.createTicket(
    { type: 'liability_threshold', severity: 'high', team: 'risk_compliance', summary: 'test' },
    trace
  )
  expect(t.ticket_id).toBeTruthy()
}

/** The P7 contract, factored out so the SAME assertion binds both the demo sim and the
 *  pre-staged OpenLineage enterprise adapter (ADR 0023 — the port-swap acceptance gate). */
async function assertP7Contract(profile: DeployProfile) {
  const p7 = getAdapter('p7-lineage', profile)
  await expect(
    p7.emitLineage({ table: 'reconciliation_break', columns: ['variance_amount'], source: 'recon-engine', trace_id: trace.trace_id })
  ).resolves.toBeUndefined()
}

/** The P6 contract (revoke SLA, dispute + deterministic directory, Ozone refund IPP status,
 *  consent-status for drift), factored out so the SAME assertions bind both the demo sim and
 *  the pre-staged egress-gateway adapter (ADR 0023 — the port-swap acceptance gate). */
async function assertP6Contract(profile: DeployProfile) {
  const p6 = getAdapter('p6-nebras-egress', profile)

  const revoke = await p6.revokeConsent('consent-001', 'CLIENT_INSTRUCTION', trace)
  expect(revoke.acknowledged_in_ms).toBeLessThan(5000) // 5s scheme SLA

  const dispute = await p6.createDisputeCase({ summary: 'fee variance' }, trace)
  expect(dispute.nebras_case_id).toBeTruthy()
  const dir1 = await p6.syncDirectory(trace)
  const dir2 = await p6.syncDirectory(trace)
  expect(dir1.participants.length).toBeGreaterThan(0)
  expect(dir1).toEqual(dir2) // deterministic for repeatable demos

  const refund = await p6.dispatchRefund('consent-001', { amount: 150000, currency: 'AED' }, trace)
  expect(['ACCC', 'ACSP', 'ACSC', 'RJCT', 'PDNG']).toContain(refund.ipp_status) // BACKOFFICE-62

  const status = await p6.getConsentStatus('consent-001', trace)
  expect(status.consent_id).toBe('consent-001')
  expect(typeof status.status).toBe('string')
  expect(status.status.length).toBeGreaterThan(0)
}

/** The P5 contract, factored out so the SAME assertion binds both the demo sim and the
 *  pre-staged OTLP/HTTP APM enterprise adapter (ADR 0023 — the port-swap acceptance gate). */
async function assertP5Contract(profile: DeployProfile) {
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
}

/**
 * Port contract suite — binds ANY adapter behind the interface. Sim adapters run
 * now; the same expectations gate enterprise adapters at M6 (port-swap acceptance).
 */
function describePortContract(profile: DeployProfile) {
  describe(`port contracts (${profile} profile)`, () => {
    it('P1 mints care tokens with act+sub claims and ≤15 min expiry', async () => {
      await assertP1Contract(profile)
    })

    it('P2 verifies tokens with MFA and exposes the 9 personas', async () => {
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
      await assertP3Contract(profile)
    })

    it('P4 reads balances as binding Money', async () => {
      const p4 = getAdapter('p4-core-banking', profile)
      const b = await p4.getBalance('acc-001', trace)
      expect(Number.isInteger(b.balance.amount)).toBe(true)
      expect(b.balance.currency).toMatch(/^[A-Z]{3}$/)
    })

    it('P5 accepts an OTel span batch', async () => {
      await assertP5Contract(profile)
    })

    it('P6 egress: revoke SLA, dispute + deterministic directory, Ozone refund, consent status', async () => {
      await assertP6Contract(profile)
    })

    it('P7 accepts column-level lineage emission', async () => {
      await assertP7Contract(profile)
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

// All nine ports are now pre-staged ahead of M6 (ADR 0023), so the FULL contract suite runs
// under the enterprise profile too — each enterprise adapter must pass EXACTLY the same
// contract the sim passes (the port-swap acceptance gate). The fakes bind with no tenant.
describePortContract('demo')
describePortContract('enterprise')

describe('enterprise adapters (ADR 0023 — all 9 pre-staged)', () => {
  it.each(PORT_NAMES.map((p) => [p] as const))('%s enterprise adapter resolves (no real tenant configured)', (port: PortName) => {
    expect(() => getAdapter(port, 'enterprise')).not.toThrow()
  })

  it('still throws NotImplemented for a port with no enterprise adapter (mechanism retained for future ports)', () => {
    expect(() => getAdapter('p99-future' as PortName, 'enterprise')).toThrow(EnterpriseAdapterNotImplementedError)
  })
})
