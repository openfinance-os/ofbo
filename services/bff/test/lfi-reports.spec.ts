import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { LfiCadenceMonitor, LFI_REPORT_TYPES } from '../src/lfi-reports/service.js'
import type { ReportStore } from '../src/reports/generation.js'
import { FAPI_HEADERS } from './helpers.js'

/**
 * BACKOFFICE-67 — manual cadence ingest of the 16 login-only Nebras LFI reports.
 * GET cadence dashboard (compliance:reports:read); POST verified multipart ingest
 * (compliance:reports:generate) → compliance_report + integrity hash + lineage;
 * headless monitor raises ITSM + Risk signal on a missed cadence.
 */

const comp = (extra: Record<string, string> = {}) => ({ ...FAPI_HEADERS, authorization: 'Bearer demo-token:compliance-officer', ...extra })

function appWith() {
  const audit = new InMemoryHighClassAuditSink()
  return { app: createApp({ highClassAudit: audit }), audit }
}

function ingestForm(extra: Partial<{ report_type: string; report_period: string; source_note: string; file: boolean }> = {}) {
  const fd = new FormData()
  if (extra.file !== false) fd.append('file', new Blob(['availability,uptime\n2026-06-15,99.98'], { type: 'text/csv' }), 'availability.csv')
  fd.append('report_type', extra.report_type ?? 'availability')
  fd.append('report_period', extra.report_period ?? '2026-06-15')
  if (extra.source_note) fd.append('source_note', extra.source_note)
  return fd
}

type CadenceRow = { report_type: string; cadence: string; overdue: boolean; last_ingested_at: string | null; next_due_at: string }
type Wire = { id: string; report_type: string; status: string; integrity_hash: string | null }

describe('GET /back-office/lfi-reports (cadence dashboard)', () => {
  it('lists all 16 report types, all overdue before any ingest (compliance:reports:read)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/lfi-reports', { headers: comp() })
    expect(res.status).toBe(200)
    const rows = ((await res.json()) as { data: CadenceRow[] }).data
    expect(rows).toHaveLength(16)
    expect(rows.every((r) => r.overdue && r.last_ingested_at === null)).toBe(true)
    expect(rows.find((r) => r.report_type === 'availability')!.cadence).toBe('daily')
    expect(rows.find((r) => r.report_type === 'billing')!.cadence).toBe('monthly')
  })

  it('rejects a persona without compliance:reports:read (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/lfi-reports', { headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst' } })
    expect(res.status).toBe(403)
  })
})

describe('POST /back-office/lfi-reports (verified ingest)', () => {
  it('ingests a report (201) with an integrity hash + one audit, and clears its overdue flag', async () => {
    const { app, audit } = appWith()
    const res = await app.request('/back-office/lfi-reports', { method: 'POST', headers: comp({ 'idempotency-key': 'i1' }), body: ingestForm() })
    expect(res.status).toBe(201)
    const rec = ((await res.json()) as { data: Wire }).data
    expect(rec.report_type).toBe('lfi_report:availability')
    expect(rec.integrity_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(audit.events.filter((e) => e.event_type === 'lfi_report_ingested')).toHaveLength(1)

    const cadence = ((await (await app.request('/back-office/lfi-reports', { headers: comp() })).json()) as { data: CadenceRow[] }).data
    const availability = cadence.find((r) => r.report_type === 'availability')!
    expect(availability.overdue).toBe(false)
    expect(availability.last_ingested_at).not.toBeNull()
  })

  it('requires Idempotency-Key (400), a known report_type (400), and a file (400)', async () => {
    const { app } = appWith()
    expect((await app.request('/back-office/lfi-reports', { method: 'POST', headers: comp(), body: ingestForm() })).status).toBe(400)
    expect((await app.request('/back-office/lfi-reports', { method: 'POST', headers: comp({ 'idempotency-key': 'i2' }), body: ingestForm({ report_type: 'not_a_real_report' }) })).status).toBe(400)
    expect((await app.request('/back-office/lfi-reports', { method: 'POST', headers: comp({ 'idempotency-key': 'i3' }), body: ingestForm({ file: false }) })).status).toBe(400)
  })

  it('rejects a persona without compliance:reports:generate (403)', async () => {
    const { app } = appWith()
    const res = await app.request('/back-office/lfi-reports', {
      method: 'POST',
      headers: { ...FAPI_HEADERS, authorization: 'Bearer demo-token:finance-analyst', 'idempotency-key': 'i4' },
      body: ingestForm()
    })
    expect(res.status).toBe(403)
  })
})

describe('LfiCadenceMonitor (BACKOFFICE-67 headless missed-cadence)', () => {
  class FakeItsm {
    tickets: Array<{ type: string; team: string }> = []
    async createTicket(input: { type: string; severity: string; team: string; summary: string }) {
      this.tickets.push({ type: input.type, team: input.team })
      return { ticket_id: `t${this.tickets.length}` }
    }
  }
  class FakeRisk {
    signals: Array<{ signal_type: string }> = []
    async record(e: { signal_type: string }) {
      this.signals.push({ signal_type: e.signal_type })
    }
  }
  const emptyReports: Pick<ReportStore, 'list'> = { list: async () => ({ rows: [], next_cursor: null }) }

  it('raises an ITSM ticket + lfi_report_cadence_missed Risk signal per overdue report type', async () => {
    const itsm = new FakeItsm()
    const riskSignals = new FakeRisk()
    const out = await new LfiCadenceMonitor({ reports: emptyReports, itsm, riskSignals }).check('trace-1')
    // all 16 are overdue (no ingests) → one ticket + one signal each
    expect(out.filter((r) => r.overdue)).toHaveLength(LFI_REPORT_TYPES.length)
    expect(itsm.tickets).toHaveLength(16)
    expect(itsm.tickets.every((t) => t.type === 'lfi_report_cadence_missed' && t.team === 'compliance')).toBe(true)
    expect(riskSignals.signals).toHaveLength(16)
    expect(riskSignals.signals.every((s) => s.signal_type === 'lfi_report_cadence_missed')).toBe(true)
  })
})
