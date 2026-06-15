import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryTppCounterpartyStore, TppRegistryService } from '../src/tpp-billing/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-72 — TPP financial-system onboarding + unbilled-traffic alert.
 * register-financial-system (billing:write) registers the counterparty in P9 and
 * tracks registration_state; observed traffic from an unregistered TPP raises an
 * ITSM ticket + a Finance View signal.
 */

const ORG = 'org-fictional-fintech-01'
const directory = [
  { organisation_id: ORG, legal_name: 'Fictional Fintech One FZ-LLC' },
  { organisation_id: 'org-fictional-fintech-02', legal_name: 'Fictional Fintech Two Ltd' }
]
class FakeDirectoryEgress {
  async syncDirectory() {
    return { participants: directory }
  }
}
const billing = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', ...extra })
const ops = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst', ...extra })

describe('POST /back-office/tpp-counterparties/{organisation_id}:register-financial-system', () => {
  let store: InMemoryTppCounterpartyStore
  let audit: InMemoryHighClassAuditSink
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    store = new InMemoryTppCounterpartyStore()
    audit = new InMemoryHighClassAuditSink()
    app = createApp({ tppCounterpartyStore: store, tppDirectoryEgress: new FakeDirectoryEgress(), highClassAudit: audit })
    await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 'seed' }) })
  })

  it('registers the counterparty in P9, tracks registration_state, clears unbilled_traffic, audits (202)', async () => {
    const res = await app.request(`/back-office/tpp-counterparties/${ORG}:register-financial-system`, { method: 'POST', headers: billing({ 'idempotency-key': 'r1' }) })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { registration_state: string; financial_system_ref: string; unbilled_traffic: boolean } }
    expect(body.data.registration_state).toBe('registered')
    expect(body.data.financial_system_ref).toMatch(/^fms-/)
    expect(body.data.unbilled_traffic).toBe(false)
    const ev = audit.events.find((e) => e.event_type === 'tpp_financial_system_registered')
    expect((ev?.request_body as { organisation_id: string }).organisation_id).toBe(ORG)
  })

  it('404 unknown org; 400 without Idempotency-Key; 403 without billing:write', async () => {
    expect((await app.request('/back-office/tpp-counterparties/org-nope:register-financial-system', { method: 'POST', headers: billing({ 'idempotency-key': 'r2' }) })).status).toBe(404)
    expect((await app.request(`/back-office/tpp-counterparties/${ORG}:register-financial-system`, { method: 'POST', headers: billing() })).status).toBe(400)
    // operations-analyst has platform:operations:write but not billing:write
    expect((await app.request(`/back-office/tpp-counterparties/${ORG}:register-financial-system`, { method: 'POST', headers: ops({ 'idempotency-key': 'r3' }) })).status).toBe(403)
  })
})

describe('unbilled-traffic alert (recordTraffic)', () => {
  class FakeItsm {
    tickets: Array<{ team: string; severity: string }> = []
    async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
      this.tickets.push({ team: input.team, severity: input.severity })
      return { ticket_id: `t-${this.tickets.length}` }
    }
  }
  class FakeFinancialSystem {
    async registerCounterparty(org: { organisation_id: string }) {
      return { financial_system_ref: `fms-${org.organisation_id}` }
    }
  }

  async function seeded() {
    const store = new InMemoryTppCounterpartyStore()
    const audit = new InMemoryHighClassAuditSink()
    const itsm = new FakeItsm()
    const svc = new TppRegistryService(store, new FakeDirectoryEgress(), audit, new FakeFinancialSystem(), itsm)
    await store.syncDirectory(directory, 't-seed')
    return { store, audit, itsm, svc }
  }

  it('observed traffic from an UNREGISTERED TPP raises an ITSM ticket + Finance signal', async () => {
    const { audit, itsm, svc } = await seeded()
    const res = await svc.recordTraffic([ORG], 't1')
    expect(res.unbilled).toEqual([ORG])
    expect(itsm.tickets).toHaveLength(1)
    expect(itsm.tickets[0]!.severity).toBe('high')
    expect(audit.events.some((e) => e.event_type === 'tpp_unbilled_traffic_alert')).toBe(true)
  })

  it('observed traffic from a REGISTERED TPP raises no alert', async () => {
    const principal = { subject: 'demo:finance-analyst', persona: 'finance-analyst' as const, scopes: ['billing:write'] }
    const { itsm, svc } = await seeded()
    await svc.registerFinancialSystem(principal, ORG, 'reg')
    const res = await svc.recordTraffic([ORG], 't2')
    expect(res.unbilled).toEqual([])
    expect(itsm.tickets).toHaveLength(0)
  })
})
