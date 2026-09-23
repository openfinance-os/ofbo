import { describe, expect, it } from 'vitest'
import type { StoredRiskSignal } from '@ofbo/db'
import { closeDuplicateSessionSignals, type SessionSignalBacklogStore } from '../src/risk-signals/session-signal-backlog.js'
import { InMemoryHighClassAuditSink, SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../src/high-class-audit.js'

const signal = (id: string, status = 'open'): StoredRiskSignal => ({
  id,
  signal_type: 'agent_anomaly',
  severity: 'info',
  status,
  client_id: null,
  channel: 'internal_retail',
  signal_data: { summary: 'super-admin session active' },
  nebras_liability_event_ref: null,
  created_at: '2026-09-01T01:00:00.000Z'
})

function store(rows: StoredRiskSignal[]): SessionSignalBacklogStore & { rows: StoredRiskSignal[] } {
  return {
    rows,
    async duplicateSuperAdminSessionSignalIds(limit) {
      return rows.filter((r) => r.status === 'open').slice(0, limit).map((r) => r.id)
    },
    async transitionSignalStatus(id, from, to) {
      const row = rows.find((r) => r.id === id && r.status === from)
      if (!row) return null
      row.status = to
      return row
    }
  }
}

describe('BACKOFFICE-80 — duplicate super-admin session signal backlog', () => {
  it('closes each duplicate to closed_no_action with ONE audit event per signal, as the system actor', async () => {
    const s = store([signal('a1b2c3d4-0000-4000-8000-000000000001'), signal('a1b2c3d4-0000-4000-8000-000000000002')])
    const audit = new InMemoryHighClassAuditSink()
    expect(await closeDuplicateSessionSignals({ store: s, audit }, 'trace-1')).toBe(2)
    expect(s.rows.map((r) => r.status)).toEqual(['closed_no_action', 'closed_no_action'])
    expect(audit.events).toHaveLength(2)
    for (const [i, e] of audit.events.entries()) {
      expect(e).toMatchObject({
        event_type: 'risk_signal_status_changed',
        acting_persona: 'system',
        scope_used: SYSTEM_ACTOR_SCOPE,
        response_status: SYSTEM_ACTOR_RESPONSE_STATUS,
        request_trace_id: 'trace-1',
        request_body: { signal_id: s.rows[i]!.id, from_status: 'open', to_status: 'closed_no_action' }
      })
      expect(e.acting_principal.startsWith('system:')).toBe(true)
    }
  })

  it('drains in bounded batches and is a no-op once drained', async () => {
    const s = store(Array.from({ length: 5 }, (_, i) => signal(`a1b2c3d4-0000-4000-8000-00000000001${i}`)))
    const audit = new InMemoryHighClassAuditSink()
    expect(await closeDuplicateSessionSignals({ store: s, audit }, 't', 2)).toBe(2)
    expect(await closeDuplicateSessionSignals({ store: s, audit }, 't', 2)).toBe(2)
    expect(await closeDuplicateSessionSignals({ store: s, audit }, 't', 2)).toBe(1)
    expect(await closeDuplicateSessionSignals({ store: s, audit }, 't', 2)).toBe(0)
    expect(audit.events).toHaveLength(5)
  })

  it('leaves a signal an analyst triaged in the meantime alone, and audits nothing for it', async () => {
    const s = store([signal('a1b2c3d4-0000-4000-8000-000000000021')])
    const triagedMidRun: SessionSignalBacklogStore = {
      duplicateSuperAdminSessionSignalIds: async (limit) => {
        const ids = await s.duplicateSuperAdminSessionSignalIds(limit)
        s.rows[0]!.status = 'investigating' // an analyst acts between the read and the close
        return ids
      },
      transitionSignalStatus: s.transitionSignalStatus
    }
    const audit = new InMemoryHighClassAuditSink()
    expect(await closeDuplicateSessionSignals({ store: triagedMidRun, audit }, 't')).toBe(0)
    expect(s.rows[0]!.status).toBe('investigating')
    expect(audit.events).toHaveLength(0)
  })
})
