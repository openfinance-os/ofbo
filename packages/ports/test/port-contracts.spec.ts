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

    it('P2 verifies tokens with MFA and exposes the 8 demo personas', async () => {
      const p2 = getAdapter('p2-identity-provider', profile)
      const personas = await p2.personaLogins()
      expect(personas).toHaveLength(8)
      expect(personas.map((p) => p.persona)).toContain('platform-super-admin')
      const claims = await p2.verifyToken(personas[0]!.demo_token)
      expect(claims.mfa).toBe(true)
      expect(claims.persona).toBe(personas[0]!.persona)
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

describe('enterprise adapters are stubs until M6', () => {
  it.each(PORT_NAMES.map((p) => [p] as const))('%s enterprise stub throws NotImplemented', (port: PortName) => {
    expect(() => getAdapter(port, 'enterprise')).toThrow(EnterpriseAdapterNotImplementedError)
  })
})

// M6 port-swap acceptance gate: when an enterprise adapter lands, it must pass
// EXACTLY the demo-profile suite above. Re-enable per port by calling
// describePortContract('enterprise') once getAdapter(port, 'enterprise') resolves.
