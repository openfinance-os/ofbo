import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryLineageReader } from '../src/lineage/service.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-49 — GET /back-office/lineage/{table_name} (compliance:reports:read).
 */
const compliance = { ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer' }

const READER = new InMemoryLineageReader({
  risk_signal: {
    table_name: 'risk_signal',
    columns: ['bank_id', 'severity', 'signal_type', 'status'],
    sources: ['bff-risk-signal-emitter'],
    event_count: 3,
    first_seen: '2026-06-10T00:00:00.000Z',
    last_seen: '2026-06-18T00:00:00.000Z',
    recent: [{ columns: ['signal_type', 'status'], source: 'bff-risk-signal-emitter', trace_id: 't1', created_at: '2026-06-18T00:00:00.000Z' }]
  }
})

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit, lineageReader: READER }), audit }
}

describe('GET /back-office/lineage/{table_name}', () => {
  it('returns the column-level lineage tree (compliance:reports:read) + logs access', async () => {
    const { app, audit } = appWith()
    const res = await app.request('/back-office/lineage/risk_signal', { headers: compliance })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: { table_name: string; columns: string[]; sources: string[]; event_count: number } }).data
    expect(data.table_name).toBe('risk_signal')
    expect(data.columns).toContain('signal_type')
    expect(data.sources).toContain('bff-risk-signal-emitter')
    expect(data.event_count).toBe(3)
    expect(audit.events.filter((e) => e.event_type === 'lineage_viewed')).toHaveLength(1)
  })

  it('404 for a table with no lineage; 400 for an invalid identifier', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/lineage/dispute_case', { headers: compliance })).status).toBe(404)
    expect((await app.request('/back-office/lineage/DROP-TABLE', { headers: compliance })).status).toBe(400)
  })

  it('rejects a persona without compliance:reports:read (403)', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/lineage/risk_signal', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })).status).toBe(403)
  })
})
