import { describe, expect, it } from 'vitest'
import { evaluateLineageGate, KNOWN_LINEAGE_GAPS } from '../src/lineage.js'

/**
 * BACKOFFICE-56 — Q4.5 gate logic. Pure unit test (no DB); the CI step feeds it
 * a coverage report from validateLineageCoverage.
 */
describe('evaluateLineageGate', () => {
  // The logic tests pass an explicit allowlist so they stay independent of the
  // (now-empty) default KNOWN_LINEAGE_GAPS.
  it('passes when every gap is a documented known-pending gap', () => {
    const r = evaluateLineageGate({ covered: ['audit_high_sensitivity', 'risk_signal', 'approval_request'], gaps: ['some_pending'] }, { some_pending: 'M9 pending' })
    expect(r.ok).toBe(true)
    expect(r.allowedGaps).toEqual(['some_pending'])
    expect(r.unexpectedGaps).toEqual([])
  })

  it('fails on an unexpected gap — a write-path table that stopped emitting lineage', () => {
    const r = evaluateLineageGate({ covered: ['risk_signal'], gaps: ['audit_high_sensitivity', 'some_pending'] }, { some_pending: 'M9 pending' })
    expect(r.ok).toBe(false)
    expect(r.unexpectedGaps).toEqual(['audit_high_sensitivity'])
    expect(r.allowedGaps).toEqual(['some_pending'])
  })

  it('passes cleanly when there are no gaps at all', () => {
    const r = evaluateLineageGate({ covered: ['audit_high_sensitivity'], gaps: [] })
    expect(r.ok).toBe(true)
    expect(r.allowedGaps).toEqual([])
  })

  it('flags a stale allowlist entry once the table becomes covered', () => {
    const r = evaluateLineageGate({ covered: ['some_pending'], gaps: [] }, { some_pending: 'M9 pending' })
    expect(r.ok).toBe(true)
    expect(r.staleAllowlist).toContain('some_pending')
  })

  it('honours a custom allowlist', () => {
    const r = evaluateLineageGate({ covered: [], gaps: ['reconciliation_log'] }, { reconciliation_log: 'M3 pending' })
    expect(r.ok).toBe(true)
    expect(r.allowedGaps).toEqual(['reconciliation_log'])
  })

  it('ships an empty default allowlist — BACKOFFICE-71 closed the last (tpp_counterparty) gap', () => {
    expect(Object.keys(KNOWN_LINEAGE_GAPS)).toHaveLength(0)
  })
})
