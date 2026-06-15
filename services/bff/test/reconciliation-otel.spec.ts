import { describe, expect, it } from 'vitest'
import type { OtelSpan } from '@ofbo/ports'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'

/**
 * BACKOFFICE-13 — OTel traces per run, per line. A parent run span + one span per
 * reconciled line, each carrying run_id, line_type, the three source refs, the
 * variance, and the decision; exported via the P5 APM bridge.
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }
const TRACE = 'b13b13b1-3b13-4b13-8b13-b13b13b13b13'

class FakeApm {
  spans: OtelSpan[] = []
  async exportSpans(spans: OtelSpan[]) {
    this.spans.push(...spans) // synchronous capture (no await before push)
  }
}
function svc(apm?: FakeApm) {
  return new ReconciliationService({
    store: new InMemoryReconciliationLogStore(),
    breakStore: new InMemoryReconciliationBreakStore(),
    audit: new InMemoryHighClassAuditSink(),
    ...(apm ? { apm } : {})
  })
}

describe('reconciliation OTel spans', () => {
  it('emits one run span + one span per reconciled line with the required attributes', async () => {
    const apm = new FakeApm()
    const run = await svc(apm).runDaily(TRACE, { window: WINDOW })

    const runSpans = apm.spans.filter((s) => s.name === 'reconciliation.run')
    const lineSpans = apm.spans.filter((s) => s.name === 'reconciliation.line')
    expect(runSpans).toHaveLength(1)
    // one line span per reconciled line (default sim: 110)
    expect(lineSpans).toHaveLength(run.result.line_count_total)

    const runSpan = runSpans[0]!
    expect(runSpan.attributes['recon.run_id']).toBe(run.run.run_id)
    expect(runSpan.attributes['recon.line_count_unmatched']).toBe(run.result.line_count_unmatched)
    // line spans are children of the run span
    expect(lineSpans.every((s) => s.parent_span_id === runSpan.span_id)).toBe(true)

    // every line span carries run_id, line_type, the three source refs, variance, decision
    for (const s of lineSpans) {
      expect(s.attributes['recon.run_id']).toBe(run.run.run_id)
      expect(typeof s.attributes['recon.line_type']).toBe('string')
      expect('recon.source_a_ref' in s.attributes).toBe(true)
      expect('recon.source_b_ref' in s.attributes).toBe(true)
      expect('recon.source_c_ref' in s.attributes).toBe(true)
      expect(['matched', 'unmatched', 'disputed']).toContain(s.attributes['recon.decision'])
      expect(typeof s.attributes['recon.variance_amount']).toBe('number')
    }

    // a fee-variance line records its decision + variance on the span
    const variance = lineSpans.find((s) => s.attributes['recon.decision'] === 'unmatched' && s.attributes['recon.variance_amount'] === 7)
    expect(variance).toBeTruthy()
    const disputed = lineSpans.filter((s) => s.attributes['recon.decision'] === 'disputed')
    expect(disputed).toHaveLength(run.result.line_count_disputed)
  })

  it('does not redact-leak the raw trace id and tags spans with the trace', async () => {
    const apm = new FakeApm()
    await svc(apm).runDaily(TRACE, { window: WINDOW })
    // the trace id is a synthetic uuid (no PII shape) so it survives redaction unchanged
    expect(apm.spans.every((s) => s.trace_id === TRACE)).toBe(true)
  })

  it('an idempotent re-run emits no spans (only an actually-executed run does)', async () => {
    const apm = new FakeApm()
    const s = svc(apm)
    await s.runDaily(TRACE, { window: WINDOW })
    const after = apm.spans.length
    await s.runDaily(TRACE, { window: WINDOW }) // same run_id ⇒ no-op
    expect(apm.spans.length).toBe(after)
  })

  it('a P5 sink outage never fails the run', async () => {
    const throwing = { exportSpans: async () => { throw new Error('apm down') } }
    const service = new ReconciliationService({
      store: new InMemoryReconciliationLogStore(),
      breakStore: new InMemoryReconciliationBreakStore(),
      audit: new InMemoryHighClassAuditSink(),
      apm: throwing
    })
    const run = await service.runDaily(TRACE, { window: WINDOW })
    expect(run.created).toBe(true)
    expect(run.run.line_count_total).toBeGreaterThan(0)
  })
})
