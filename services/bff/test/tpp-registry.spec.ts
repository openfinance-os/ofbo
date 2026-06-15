import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryTppCounterpartyStore } from '../src/tpp-billing/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-71 — consuming-TPP registry + Trust Framework Directory sync.
 * List/detail billing:read; sync platform:operations:write (202). The sync flags
 * new / changed / decommissioned TPPs.
 */

class FakeDirectoryEgress {
  participants = [
    { organisation_id: 'org-fictional-fintech-01', legal_name: 'Fictional Fintech One FZ-LLC' },
    { organisation_id: 'org-fictional-fintech-02', legal_name: 'Fictional Fintech Two Ltd' },
    { organisation_id: 'org-fictional-fintech-03', legal_name: 'Fictional Payments Co PSC' }
  ]
  async syncDirectory() {
    return { participants: this.participants }
  }
}

const finance = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', ...extra })
const ops = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:operations-analyst', ...extra })

let store: InMemoryTppCounterpartyStore
let egress: FakeDirectoryEgress
let audit: InMemoryHighClassAuditSink
let app: ReturnType<typeof createApp>

beforeEach(() => {
  store = new InMemoryTppCounterpartyStore()
  egress = new FakeDirectoryEgress()
  audit = new InMemoryHighClassAuditSink()
  app = createApp({ tppCounterpartyStore: store, tppDirectoryEgress: egress, highClassAudit: audit })
})

describe('POST /back-office/tpp-counterparties:sync-directory', () => {
  it('syncs the directory into the registry, flags new TPPs, and audits (202)', async () => {
    const res = await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 's1' }) })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { data: { synced: number; added: string[]; changed: string[]; decommissioned: string[] } }
    expect(body.data.synced).toBe(3)
    expect(body.data.added.sort()).toEqual(['org-fictional-fintech-01', 'org-fictional-fintech-02', 'org-fictional-fintech-03'])
    const ev = audit.events.find((e) => e.event_type === 'tpp_directory_synced')
    expect((ev?.request_body as { synced: number }).synced).toBe(3)
  })

  it('flags changed legal names and decommissioned (dropped) TPPs on a subsequent sync', async () => {
    await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 's2a' }) })
    // org-01 renamed, org-03 dropped from the directory
    egress.participants = [
      { organisation_id: 'org-fictional-fintech-01', legal_name: 'Fictional Fintech One PLC' },
      { organisation_id: 'org-fictional-fintech-02', legal_name: 'Fictional Fintech Two Ltd' }
    ]
    const res = await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 's2b' }) })
    const body = (await res.json()) as { data: { added: string[]; changed: string[]; decommissioned: string[] } }
    expect(body.data.added).toEqual([])
    expect(body.data.changed).toEqual(['org-fictional-fintech-01'])
    expect(body.data.decommissioned).toEqual(['org-fictional-fintech-03'])
    const dropped = await store.get('org-fictional-fintech-03')
    expect(dropped?.production_status).toBe('decommissioned')
  })

  it('replays the Idempotency-Key (no second sync side effects)', async () => {
    const first = await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 'dup' }) })
    const a = (await first.json()) as { data: { added: string[] } }
    expect(a.data.added).toHaveLength(3)
    const replay = await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 'dup' }) })
    const b = (await replay.json()) as { data: { added: string[] } }
    expect(b.data.added).toHaveLength(3) // replayed original result (added 3), not a re-sync that would add 0
  })

  it('400 without Idempotency-Key; 403 without platform:operations:write', async () => {
    expect((await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops() })).status).toBe(400)
    expect((await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: finance({ 'idempotency-key': 's3' }) })).status).toBe(403)
  })
})

describe('GET /back-office/tpp-counterparties (+ detail)', () => {
  it('lists the registry + filters; detail returns one; 404 unknown; billing:read enforced', async () => {
    await app.request('/back-office/tpp-counterparties:sync-directory', { method: 'POST', headers: ops({ 'idempotency-key': 'g1' }) })
    const list = await app.request('/back-office/tpp-counterparties', { headers: finance() })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { data: Array<{ organisation_id: string; production_status: string; registration_state: string }> }
    expect(body.data).toHaveLength(3)
    expect(body.data.every((r) => r.production_status === 'directory_only' && r.registration_state === 'unregistered')).toBe(true)

    const filtered = await app.request('/back-office/tpp-counterparties?production_status=decommissioned', { headers: finance() })
    expect(((await filtered.json()) as { data: unknown[] }).data).toHaveLength(0)

    const detail = await app.request('/back-office/tpp-counterparties/org-fictional-fintech-02', { headers: finance() })
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as { data: { organisation_id: string } }).data.organisation_id).toBe('org-fictional-fintech-02')

    expect((await app.request('/back-office/tpp-counterparties/org-nope', { headers: finance() })).status).toBe(404)
    expect((await app.request('/back-office/tpp-counterparties', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:customer-care-agent' } })).status).toBe(403)
  })
})
