import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '@ofbo/billing'
import {
  PayablePeriodService,
  tppCostEvidenceExportBody,
  tppCostEvidenceExportDigest
} from '../src/billing/payable-period.js'
import type { Principal } from '../src/auth.js'

/**
 * BILL-17 — the governed TPP cost evidence export.
 *
 * The property that matters is not "it returns rows" but that a RECIPIENT can prove the file was
 * not edited after issue. So the digest is recomputed here the way an outside party would — from
 * the published body, with an independent hash — rather than by calling the same helper twice and
 * asserting a string equals itself.
 */

const PERIOD = '2026-06'

const PACK = {
  documents: [{ id: 'doc-1', document_reference: 'NEB-2026-06', lines: [{ line_ref: 'L1' }] }],
  reconciliations: [{ id: 'rec-1', billing_period: PERIOD }],
  diffLines: [{ line_ref: 'L1', break_type: 'vat_variance' }],
  closes: [{ id: 'close-1', billing_period: PERIOD }],
  dispatches: [{ id: 'ap-1', dispatch_state: 'accepted' }]
}

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    subject: 'demo:finance-analyst@bank',
    persona: 'finance-analyst',
    scopes: ['billing:read'],
    ...overrides
  } as Principal
}

function service(overrides: Record<string, unknown> = {}) {
  const audit = { emit: vi.fn(async (_event: Record<string, unknown>) => undefined) }
  const store = {
    periodClose: vi.fn(async () => null),
    payablesForPeriod: vi.fn(async () => []),
    openPayableBreaks: vi.fn(async () => []),
    evidencePack: vi.fn(async () => PACK)
  }
  const svc = new PayablePeriodService({
    store: store as never,
    audit: audit as never,
    now: () => new Date('2026-07-05T10:00:00.000Z'),
    ...overrides
  })
  return { svc, audit, store }
}

describe('BILL-17 governed TPP cost evidence export', () => {
  it('publishes a digest an outside party can recompute from the body alone', async () => {
    const { svc } = service()
    const pack = await svc.exportEvidence(principal(), PERIOD, 'trace-1') as Record<string, unknown>

    const { sha256, ...body } = pack
    // Recomputed independently: canonical JSON, then a fresh SHA-256. This is exactly what a
    // recipient holding only the downloaded file can do.
    const recomputed = createHash('sha256').update(canonicalJson(body)).digest('hex')
    expect(sha256).toBe(recomputed)
  })

  it('excludes the digest from what the digest covers', async () => {
    // A digest that covered itself could never be recomputed — the recipient would have to know the
    // answer to check the answer. Pinned because it is the kind of thing a refactor silently breaks.
    const body = tppCostEvidenceExportBody({
      period: PERIOD, generatedAt: '2026-07-05T10:00:00.000Z', pack: PACK
    })
    expect(Object.keys(body)).not.toContain('sha256')
    expect(tppCostEvidenceExportDigest(body)).toBe(tppCostEvidenceExportDigest({ ...body }))
  })

  it('changes the digest when any record changes', async () => {
    const base = tppCostEvidenceExportBody({
      period: PERIOD, generatedAt: '2026-07-05T10:00:00.000Z', pack: PACK
    })
    const tampered = tppCostEvidenceExportBody({
      period: PERIOD,
      generatedAt: '2026-07-05T10:00:00.000Z',
      pack: { ...PACK, dispatches: [{ id: 'ap-1', dispatch_state: 'rejected' }] }
    })
    expect(tppCostEvidenceExportDigest(base)).not.toBe(tppCostEvidenceExportDigest(tampered))
  })

  it('is insensitive to key order, so recomputation is not a coin flip on serialisation', () => {
    const a = tppCostEvidenceExportDigest({ period: PERIOD, generated_at: 'x', schema_version: '1' })
    const b = tppCostEvidenceExportDigest({ schema_version: '1', generated_at: 'x', period: PERIOD })
    expect(a).toBe(b)
  })

  it('counts every collection, so a truncated file is detectable without parsing it', async () => {
    const { svc } = service()
    const pack = await svc.exportEvidence(principal(), PERIOD, 'trace-1') as Record<string, unknown>
    expect(pack.record_counts).toEqual({
      documents: 1, reconciliations: 1, diff_lines: 1, closes: 1, dispatches: 1
    })
  })

  it('audits every export with the digest and counts, and never the evidence itself', async () => {
    const { svc, audit } = service()
    await svc.exportEvidence(principal(), PERIOD, 'trace-1')

    expect(audit.emit).toHaveBeenCalledTimes(1)
    const event = audit.emit.mock.calls[0]![0]
    expect(event.event_type).toBe('billing_tpp_cost_evidence_exported')
    expect(event.request_trace_id).toBe('trace-1')
    const body = event.request_body as Record<string, unknown>
    expect(body.period).toBe(PERIOD)
    expect(typeof body.sha256).toBe('string')
    // Copying the pack into the audit row would duplicate the whole ledger into a second
    // INSERT-only store on every download.
    expect(JSON.stringify(body)).not.toContain('NEB-2026-06')
  })

  it('refuses rather than exporting unaudited when no sink is configured', async () => {
    const { svc } = service({ audit: undefined })
    await expect(svc.exportEvidence(principal(), PERIOD, 'trace-1')).rejects.toMatchObject({
      code: 'BACKOFFICE.EXPORT_NOT_GOVERNED',
      status: 503
    })
  })

  it('refuses a period that is not YYYY-MM before touching the store', async () => {
    const { svc, store } = service()
    await expect(svc.exportEvidence(principal(), '2026-13', 'trace-1')).rejects.toMatchObject({
      code: 'BACKOFFICE.INVALID_PERIOD',
      status: 400
    })
    expect(store.evidencePack).not.toHaveBeenCalled()
  })

  it('refuses a principal without billing:read', async () => {
    const { svc } = service()
    await expect(
      svc.exportEvidence(principal({ scopes: ['reconciliation:read'] }), PERIOD, 'trace-1')
    ).rejects.toThrow()
  })

  it('refuses an unauthenticated caller', async () => {
    const { svc } = service()
    await expect(svc.exportEvidence(undefined, PERIOD, 'trace-1')).rejects.toMatchObject({
      status: 401
    })
  })
})
