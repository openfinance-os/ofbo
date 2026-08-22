import { describe, expect, it } from 'vitest'
import { PORT_NAMES, getAdapter, type PortName } from '../src/registry.js'
import type { PortMap } from '../src/interfaces.js'
import { buildEnterpriseBench } from './fixtures/enterprise-harness.js'
import { EnterpriseAdapterNotImplementedError } from '../src/types.js'

const trace = { trace_id: '4d2c2e2a-0000-4000-8000-000000000000' }

/**
 * Port contract suite — binds ANY adapter behind the interface, and is now RUN against both
 * profiles (HARNESS-10). CLAUDE.md: "an enterprise adapter must pass exactly the tests the
 * simulator passes — that is the port-swap acceptance gate, M6". Until HARNESS-10 this
 * function was literally typed `profile: 'demo'` and never invoked for anything else, so the
 * gate was carried by a comment rather than by code.
 *
 * `get` resolves a port to the adapter under test, so the SAME assertions drive the sim
 * adapters and the enterprise adapters (the latter configured + transport-faked by
 * fixtures/enterprise-harness.ts).
 *
 * One expectation is a fact about the DEMO PROFILE rather than about the port contract — the
 * nine seeded personas with demo tokens. A real IdP does not expose them, and asserting it
 * should would be a fake gate. It is REGISTERED only under demo — never a skip marker, which
 * Q1b blocks and which reads identically to "disabled because it was failing" — and the
 * enterprise-side truth is asserted explicitly instead, so the difference between the two
 * profiles is auditable rather than implied.
 */
function describePortContract(
  profile: 'demo' | 'enterprise',
  get: <K extends PortName>(port: K) => PortMap[K]
) {
  describe(`port contracts (${profile} profile)`, () => {
    it('P1 mints care tokens with act+sub claims and ≤15 min expiry', async () => {
      const p1 = get('p1-care-surface')
      const t = await p1.mintCareToken({ agent_id: 'agent-001', psu_id: 'psu-001' }, trace)
      expect(t.act).toBe('agent-001')
      expect(t.sub).toBe('psu-001')
      expect(t.token).toBeTruthy()
      expect(new Date(t.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    })

    // Registered ONLY under the demo profile — deliberately NOT a skip marker. Q1b
    // (anti-reward-hacking) blocks those, and rightly: "skipped" in a report is
    // indistinguishable from "disabled because it was failing". There is no enterprise
    // expectation being suppressed here — a real Entra tenant has no demo personas at all, so
    // there is nothing to assert. The enterprise-side truth is asserted separately below
    // (personas derive from configured mapping; no demo token is ever issued).
    if (profile === 'demo') {
      it('P2 verifies tokens with MFA and exposes the 9 demo personas', async () => {
        const p2 = get('p2-identity-provider')
        const personas = await p2.personaLogins()
        expect(personas).toHaveLength(9)
        expect(personas.map((p) => p.persona)).toContain('platform-super-admin')
        expect(personas.map((p) => p.persona)).toContain('platform-admin')
        const claims = await p2.verifyToken(personas[0]!.demo_token)
        expect(claims.mfa).toBe(true)
        expect(claims.persona).toBe(personas[0]!.persona)
      })
    }

    it('P2 mints + verifies an agent session token (ADR 0018) — round-trip carries the bound identity', async () => {
      const p2 = get('p2-identity-provider')
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
      const p2 = get('p2-identity-provider')
      expect(await p2.verifyAgentSession('demo-token:platform-admin')).toBeNull()
      expect(await p2.verifyAgentSession('not-a-token')).toBeNull()
    })

    it('P2 rejects a tampered agent session token (forged identity must not verify)', async () => {
      const p2 = get('p2-identity-provider')
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
      const p3 = get('p3-itsm')
      const t = await p3.createTicket(
        { type: 'liability_threshold', severity: 'high', team: 'risk_compliance', summary: 'test' },
        trace
      )
      expect(t.ticket_id).toBeTruthy()
    })

    it('P4 reads balances as binding Money', async () => {
      const p4 = get('p4-core-banking')
      const b = await p4.getBalance('acc-001', trace)
      expect(Number.isInteger(b.balance.amount)).toBe(true)
      expect(b.balance.currency).toMatch(/^[A-Z]{3}$/)
    })

    it('P5 accepts an OTel span batch', async () => {
      const p5 = get('p5-apm')
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
      const p6 = get('p6-nebras-egress')
      const r = await p6.revokeConsent('consent-001', 'CLIENT_INSTRUCTION', trace)
      expect(r.acknowledged_in_ms).toBeLessThan(5000)
    })

    it('P6 creates dispute cases and syncs the directory deterministically', async () => {
      const p6 = get('p6-nebras-egress')
      const d = await p6.createDisputeCase({ summary: 'fee variance' }, trace)
      expect(d.nebras_case_id).toBeTruthy()
      const dir1 = await p6.syncDirectory(trace)
      const dir2 = await p6.syncDirectory(trace)
      expect(dir1.participants.length).toBeGreaterThan(0)
      expect(dir1).toEqual(dir2) // deterministic for repeatable demos
    })

    it('P6 dispatches a refund via the Ozone Connect flow, returning an IPP status (BACKOFFICE-62)', async () => {
      const p6 = get('p6-nebras-egress')
      const r = await p6.dispatchRefund('consent-001', { amount: 150000, currency: 'AED' }, trace)
      expect(['ACCC', 'ACSP', 'ACSC', 'RJCT', 'PDNG']).toContain(r.ipp_status)
    })

    it('P6 reports a consent status for drift checks (DEMO-01)', async () => {
      const p6 = get('p6-nebras-egress')
      const r = await p6.getConsentStatus('consent-001', trace)
      expect(r.consent_id).toBe('consent-001')
      expect(typeof r.status).toBe('string')
      expect(r.status.length).toBeGreaterThan(0)
    })

    it('P7 accepts column-level lineage emission', async () => {
      const p7 = get('p7-lineage')
      await expect(
        p7.emitLineage({ table: 'reconciliation_break', columns: ['variance_amount'], source: 'recon-engine', trace_id: trace.trace_id })
      ).resolves.toBeUndefined()
    })

    it('P8 yields funnel events with entry-path dimension', async () => {
      const p8 = get('p8-onboarding-handover')
      const events = await p8.getFunnelEvents({ from: '2026-01-01', to: '2026-12-31' })
      expect(events.length).toBeGreaterThan(0)
      for (const e of events) expect(['DIRECT_SIGNUP', 'ONBOARDING_HANDOVER']).toContain(e.entry_path)
    })

    it('P9 registers counterparties and tracks settlement', async () => {
      const p9 = get('p9-financial-system')
      const reg = await p9.registerCounterparty({ organisation_id: 'org-001', legal_name: 'Fictional Fintech FZ-LLC' }, trace)
      expect(reg.financial_system_ref).toBeTruthy()
      const status = await p9.getSettlementStatus(reg.financial_system_ref, trace)
      expect(['instructed', 'issued', 'settled', 'overdue', 'credit_noted']).toContain(status.invoice_status)
      const posted = await p9.postJournalInstructions({
        batch_id: 'GL-2026-06', period: '2026-06', posting_date: '2026-07-31', account_profile_ref: 'DEMO-COA',
        journals: [{ journal_id: 'JRN-1', source_type: 'pint_ae_invoice', source_id: 'INV-1', lines: [
          { account: 'AR', side: 'debit', amount_fils: 105 },
          { account: 'REV', side: 'credit', amount_fils: 100 },
          { account: 'VAT', side: 'credit', amount_fils: 5 }
        ] }]
      }, trace)
      expect(posted.accepted).toBe(true)
      expect(posted.journal_batch_ref).toBeTruthy()
    })

    it('P9 dispatches an approved payable idempotently and reports its status (BILL-16)', async () => {
      // The port-swap gate: a new port method cannot skip it. These same assertions drive the sim
      // adapter and the enterprise adapter, so the replay and fail-closed guarantees are properties
      // of the INTERFACE rather than of whichever implementation happens to be wired.
      const p9 = get('p9-financial-system')
      const instruction = {
        payable_id: 'PAY-2026-06-001',
        period: '2026-06',
        counterparty_id: 'NEBRAS',
        counterparty_type: 'nebras' as const,
        amount_fils: 2625,
        currency: 'AED',
        approval_request_id: 'apr-0000-4000-8000-000000000001',
        document_reference: 'NEB-INV-2026-06-0001',
        idempotency_key: `pay-${profile}-2026-06-001`
      }

      const first = await p9.dispatchPayableInstruction(instruction, trace)
      expect(first.accepted).toBe(true)
      expect(first.dispatch_ref).toBeTruthy()
      expect(first.replayed).toBe(false)
      expect(['dispatched', 'mandate_active', 'presented', 'collected']).toContain(first.payable_status)

      // Retry-safe: IG §10.14–10.15 collection is a direct-debit PULL, so a duplicated dispatch would
      // authorise honouring the same debit twice.
      const replay = await p9.dispatchPayableInstruction(instruction, trace)
      expect(replay.dispatch_ref).toBe(first.dispatch_ref)
      expect(replay.replayed).toBe(true)

      const status = await p9.getPayableStatus(first.dispatch_ref, trace)
      expect(['dispatched', 'mandate_active', 'presented', 'collected', 'rejected'])
        .toContain(status.payable_status)
    })

    it('P9 REFUSES a payable carrying no four-eyes approval reference (BILL-16)', async () => {
      // Downstream fail-closed. The four-eyes gate is enforced in the service layer; this asserts the
      // port does not quietly accept a payable that arrived without it, which is what would make the
      // gate bypassable by anything that can reach the adapter.
      const p9 = get('p9-financial-system')
      await expect(p9.dispatchPayableInstruction({
        payable_id: 'PAY-2026-06-002',
        period: '2026-06',
        counterparty_id: 'NEBRAS',
        counterparty_type: 'nebras',
        amount_fils: 1000,
        currency: 'AED',
        approval_request_id: '   ',
        document_reference: 'NEB-INV-2026-06-0002',
        idempotency_key: `pay-${profile}-2026-06-002`
      }, trace)).rejects.toThrow()
    })

    it('P10 hands an STR draft to the bank workflow and returns a workflow ref (never calls AML GO)', async () => {
      const p10 = get('p10-str-workflow')
      const out = await p10.handoffStrDraft(
        { str_draft_id: '5f0e63c0-0000-4000-8000-0000000000a1', source_consent_id: 'consent-demo-7741', case_context: 'synthetic' },
        trace
      )
      expect(out.workflow_ref).toBeTruthy()
      expect(out.accepted_at).toBeTruthy()
    })

    it('P11 submits reconciled PINT AE artifacts and reports the Tax Data Document', async () => {
      const p11 = get('p11-einvoicing-asp')
      const out = await p11.submitDocument({
        document_id: 'INV-2026-06-TPP-A',
        document_type: '380',
        customization_id: 'urn:peppol:pint:billing-1@ae-1',
        profile_id: 'urn:peppol:bis:billing',
        mode: 'voluntary_pilot',
        xml: '<Invoice><cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode></Invoice>',
        pdf: new TextEncoder().encode('%PDF-1.4 synthetic')
      }, trace)
      expect(out).toMatchObject({ accepted: true, document_status: 'accepted', tdd_status: 'reported' })
      expect(out.submission_ref).toContain('INV-2026-06-TPP-A')
    })
  })
}

describePortContract('demo', (port) => getAdapter(port, 'demo'))

// HARNESS-10 — the port-swap acceptance gate, now executable. Every enterprise adapter is
// constructed from Bank-Profile-shaped config with a faked vendor transport, then driven
// through EXACTLY the assertions above. This proves the request-build → parse → map path an
// M6 swap depends on; it does NOT prove a live tenant (auth, residency, real payload drift are
// the rung-④ mile). That boundary is stated, not blurred.
const enterpriseBench = buildEnterpriseBench()
describePortContract('enterprise', (port) => enterpriseBench[port])

describe('HARNESS-10 — the port-swap gate itself', () => {
  // A gate that silently stops covering a port is the failure class this work closes. If a new
  // port is added to PORT_NAMES without a bench entry, the enterprise contract run would simply
  // never exercise it — and nothing above would go red. This makes that omission fail here.
  it('the enterprise bench covers EVERY port — a new port cannot skip the gate', () => {
    const bench = buildEnterpriseBench()
    for (const port of PORT_NAMES) {
      expect(bench[port], `no enterprise bench entry for ${port}`).toBeTruthy()
    }
    expect(Object.keys(bench).sort()).toEqual([...PORT_NAMES].sort())
  })

  // The one contract expectation that is DEMO-only (nine seeded personas with demo tokens) is
  // skipped under enterprise rather than faked. Skipping silently would hide it, so the
  // enterprise-side truth is asserted explicitly instead: personas come from Bank-Profile
  // CONFIG, and no demo token is ever issued by the enterprise IdP.
  it('P2 enterprise derives personas from configured mapping and issues NO demo tokens', async () => {
    const p2 = buildEnterpriseBench()['p2-identity-provider']
    const personas = await p2.personaLogins()
    expect(personas.map((p) => p.persona)).toEqual(['compliance-officer'])
    expect(personas.every((p) => p.demo_token === '')).toBe(true)
    expect(personas.map((p) => p.persona)).not.toContain('platform-super-admin')
  })
})

describe('enterprise adapters land port-by-port (M6)', () => {
  // P2 (Entra ID) is the reference template; P1/P3–P10 follow ADR 0024 and P11 follows the
  // same port-swap discipline. ALL eleven are WIRED — none throws NotImplemented — and each is FAIL-CLOSED: an
  // unconfigured enterprise adapter throws a clear config error, never a silent demo/fake (their
  // own contract suites are the per-adapter *.spec.ts files, which inject fakes).
  const PRESTAGED = PORT_NAMES.filter((p) => p !== 'p2-identity-provider')

  it.each(PRESTAGED.map((p) => [p] as const))('%s is WIRED and FAIL-CLOSED when unconfigured (never NotImplemented, never a fake)', (port: PortName) => {
    const saved = process.env
    process.env = {} as NodeJS.ProcessEnv // no vendor config → must throw a config error, not bind a fake
    let err: unknown
    try {
      getAdapter(port, 'enterprise')
    } catch (e) {
      err = e
    } finally {
      process.env = saved
    }
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(EnterpriseAdapterNotImplementedError) // it IS wired
  })

  it('still throws NotImplemented for a port with no enterprise factory (mechanism retained for future ports)', () => {
    expect(() => getAdapter('p99-future' as PortName, 'enterprise')).toThrow(EnterpriseAdapterNotImplementedError)
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
})

// M6 port-swap acceptance gate: when an enterprise adapter lands, it must pass
// EXACTLY the demo-profile suite above. Re-enable per port by calling
// describePortContract('enterprise') once getAdapter(port, 'enterprise') resolves.
