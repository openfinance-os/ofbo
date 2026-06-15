import { describe, expect, it } from 'vitest'
import { classifyCert, worstStatus, CertExpiryMonitor, DemoCertChainSource, type SchemeCertificate } from '../src/ops/cert-expiry.js'
import { OperationsConsoleService } from '../src/analytics/operations-console.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import type { Principal } from '../src/auth.js'

/**
 * BACKOFFICE-66 — scheme certificate expiry monitoring: amber ≤60d, red ≤30d (+ P3
 * ITSM ticket), critical ≤7d (+ ticket AND a High-class audit entry); the classified
 * chain is surfaced in the Operations Console.
 */

const NOW = new Date('2026-06-16T00:00:00.000Z')
const plus = (days: number) => new Date(NOW.getTime() + days * 24 * 3600 * 1000).toISOString()
const cert = (role: SchemeCertificate['role'], days: number): SchemeCertificate => ({ name: `${role}-cert`, role, subject: `CN=${role}`, expires_at: plus(days) })

class FakeItsm {
  tickets: { type: string; severity: string; team: string }[] = []
  async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
    this.tickets.push({ type: input.type, severity: input.severity, team: input.team })
    return { ticket_id: `tk-${this.tickets.length}` }
  }
}

describe('classifyCert (60/30/7-day bands)', () => {
  it('classifies ok / amber / red / critical by days-to-expiry incl. boundaries', () => {
    expect(classifyCert(cert('root_ca', 90), NOW).status).toBe('ok')
    expect(classifyCert(cert('root_ca', 61), NOW).status).toBe('ok')
    expect(classifyCert(cert('intermediate', 60), NOW).status).toBe('amber') // ≤60
    expect(classifyCert(cert('intermediate', 31), NOW).status).toBe('amber')
    expect(classifyCert(cert('intermediate', 30), NOW).status).toBe('red') // ≤30
    expect(classifyCert(cert('end_entity', 8), NOW).status).toBe('red')
    expect(classifyCert(cert('end_entity', 7), NOW).status).toBe('critical') // ≤7
    expect(classifyCert(cert('end_entity', 3), NOW).status).toBe('critical')
    expect(classifyCert(cert('end_entity', 7), NOW).days_to_expiry).toBe(7)
  })

  it('worstStatus picks the most severe in the chain', () => {
    expect(worstStatus([classifyCert(cert('root_ca', 90), NOW), classifyCert(cert('intermediate', 20), NOW), classifyCert(cert('end_entity', 5), NOW)])).toBe('critical')
    expect(worstStatus([classifyCert(cert('root_ca', 90), NOW), classifyCert(cert('intermediate', 45), NOW)])).toBe('amber')
  })
})

describe('CertExpiryMonitor escalation', () => {
  it('red → ITSM ticket only; critical → ticket + High-class audit; ok/amber → neither', async () => {
    const itsm = new FakeItsm()
    const audit = new InMemoryHighClassAuditSink()
    const source = { getCertificateChain: async () => [cert('root_ca', 90), cert('intermediate', 20), cert('end_entity', 5)] }
    const out = await new CertExpiryMonitor({ source, itsm, audit, now: () => NOW }).check('t')

    const root = out.find((c) => c.role === 'root_ca')!
    const inter = out.find((c) => c.role === 'intermediate')!
    const end = out.find((c) => c.role === 'end_entity')!
    expect(root.status).toBe('ok')
    expect(root.ticketed).toBe(false)
    expect(inter.status).toBe('red')
    expect(inter.ticketed).toBe(true)
    expect(inter.audited).toBe(false) // red does not audit
    expect(end.status).toBe('critical')
    expect(end.ticketed).toBe(true)
    expect(end.audited).toBe(true)

    expect(itsm.tickets.filter((t) => t.type === 'scheme_cert_expiry').length).toBe(2) // red + critical
    expect(itsm.tickets.every((t) => t.team === 'security')).toBe(true)
    expect(itsm.tickets.find((t) => t.severity === 'critical')).toBeTruthy()
    const auditEv = audit.events.filter((e) => e.event_type === 'cert_expiry_critical')
    expect(auditEv).toHaveLength(1)
    expect((auditEv[0]!.request_body as { role: string }).role).toBe('end_entity')
  })

  it('without an ITSM port, classifies but raises no tickets', async () => {
    const source = { getCertificateChain: async () => [cert('end_entity', 3)] }
    const out = await new CertExpiryMonitor({ source, now: () => NOW }).check('t')
    expect(out[0]!.status).toBe('critical')
    expect(out[0]!.ticketed).toBe(false)
    expect(out[0]!.audited).toBe(false)
  })

  it('DemoCertChainSource yields a root(ok) → intermediate(red) → end-entity(critical) chain', async () => {
    const out = await new CertExpiryMonitor({ source: new DemoCertChainSource(() => NOW), now: () => NOW }).check('t')
    expect(out.map((c) => c.status)).toEqual(['ok', 'red', 'critical'])
  })
})

describe('Operations Console certificate surface (BACKOFFICE-66)', () => {
  const ops: Principal = { subject: 'demo:ops', persona: 'operations-analyst', scopes: ['platform:operations:read'] }
  it('surfaces the classified chain + worst_status in data.scheme_certificates', async () => {
    const svc = new OperationsConsoleService({
      certifications: { list: async () => [] },
      outages: { listActive: async () => [] },
      connectivity: { latest: async () => ({ ingested_at: '2026-06-15T11:00:00.000Z', published_at: '2026-05-28T00:00:00.000Z', freshness: 'fresh' }) },
      pipeline: { pipelineCounts: async () => ({}) },
      handover: { getFunnelEvents: async () => [] },
      certChain: { getCertificateChain: async () => [cert('root_ca', 90), cert('end_entity', 4)] },
      now: () => NOW
    })
    const { data } = await svc.view(ops)
    const sc = data.scheme_certificates as { chain: { role: string; status: string }[]; worst_status: string }
    expect(sc.chain).toHaveLength(2)
    expect(sc.worst_status).toBe('critical')
  })
})
