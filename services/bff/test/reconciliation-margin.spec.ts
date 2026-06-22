import { describe, expect, it } from 'vitest'
import { computeTppAasMargin, mergeMargin, productFamily, emptyMargin } from '../src/reconciliation/margin.js'
import { buildSimReconSources } from '../src/reconciliation/sources.js'
import { InMemoryHighClassAuditSink } from '../src/high-class-audit.js'
import { InMemoryReconciliationBreakStore, InMemoryReconciliationLogStore, ReconciliationService } from '../src/reconciliation/service.js'
import type { NebrasBillingLine, FintechBillingLine, PlatformLogLine } from '../src/reconciliation/engine.js'

/**
 * BACKOFFICE-07 — TPP-aaS pass-through billing + margin. The bank pays Nebras a
 * per-call fee and re-bills the fintech with margin; margin = fintech charge −
 * Nebras fee, per fintech (client_id) + product family (SIP/AISP/CoP).
 */

const WINDOW = { start: '2026-07-14T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' }

describe('productFamily', () => {
  it('maps line types to commercial families', () => {
    expect(productFamily('payment_settlement')).toBe('SIP')
    expect(productFamily('tpp_aas_pass_through')).toBe('AISP')
    expect(productFamily('lfi_access_log')).toBe('AISP')
    expect(productFamily('consent_record')).toBe('CoP')
    expect(productFamily('nebras_fees')).toBe('OTHER')
  })
})

describe('computeTppAasMargin', () => {
  it('correlates Nebras fee with the fintech re-bill, bucketed per fintech + family', () => {
    const nebras: NebrasBillingLine[] = [
      { line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-A', billed_fee: { amount: 10, currency: 'AED' } },
      { line_ref: 'P2', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-B', billed_fee: { amount: 4, currency: 'AED' } }
    ]
    const platform: PlatformLogLine[] = [
      { line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-A', call_count: 40, call_success: true },
      { line_ref: 'P2', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-B', call_count: 40, call_success: true }
    ]
    const fintech: FintechBillingLine[] = [
      { line_ref: 'P1', billed_fee: { amount: 13, currency: 'AED' } }, // margin 3 for fin-A
      { line_ref: 'P2', billed_fee: { amount: 6, currency: 'AED' } } // margin 2 for fin-B
    ]
    const m = computeTppAasMargin({ nebras, fintech, platform })
    expect(m.total_nebras_fee).toBe(14)
    expect(m.total_fintech_charge).toBe(19)
    expect(m.total_margin).toBe(5)
    expect(m.by_fintech['fin-A']!.by_family.AISP!.margin).toBe(3)
    expect(m.by_fintech['fin-B']!.total_margin).toBe(2)
  })

  it('ignores fintech entries with no correlated Nebras line', () => {
    const m = computeTppAasMargin({
      nebras: [],
      platform: [],
      fintech: [{ line_ref: 'orphan', billed_fee: { amount: 9, currency: 'AED' } }]
    })
    expect(m.total_margin).toBe(0)
    expect(Object.keys(m.by_fintech)).toHaveLength(0)
  })

  it('mergeMargin accumulates per-run summaries', () => {
    const a = computeTppAasMargin({
      nebras: [{ line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-A', billed_fee: { amount: 10, currency: 'AED' } }],
      platform: [{ line_ref: 'P1', line_type: 'tpp_aas_pass_through', channel: 'external_tpp_aas', client_id: 'fin-A', call_count: 40, call_success: true }],
      fintech: [{ line_ref: 'P1', billed_fee: { amount: 13, currency: 'AED' } }]
    })
    const merged = mergeMargin(mergeMargin(emptyMargin(), a), a)
    expect(merged.total_margin).toBe(6) // 3 + 3
    expect(merged.by_fintech['fin-A']!.total_margin).toBe(6)
  })

  it('the deterministic sim produces a positive TPP-aaS margin (fintech re-bill > Nebras fee)', async () => {
    const bundle = buildSimReconSources('2026-07-14')
    const [nebras, fintech, platform] = await Promise.all([bundle.nebras.fetch(WINDOW), bundle.fintech.fetch(WINDOW), bundle.platform.fetch(WINDOW)])
    const m = computeTppAasMargin({ nebras, fintech, platform })
    expect(m.total_margin).toBeGreaterThan(0)
    // margin attributed to AISP (pass-through is data-sharing) across ≥1 fintech
    expect(Object.values(m.by_fintech).some((f) => f.by_family.AISP && f.by_family.AISP.margin > 0)).toBe(true)
  })

  it('the sim re-bills consuming fintechs across SIP, AISP and CoP families (demo depth)', async () => {
    const bundle = buildSimReconSources('2026-07-14')
    const [nebras, fintech, platform] = await Promise.all([bundle.nebras.fetch(WINDOW), bundle.fintech.fetch(WINDOW), bundle.platform.fetch(WINDOW)])
    const m = computeTppAasMargin({ nebras, fintech, platform })
    // aggregate the per-fintech breakdown into a flat set of families that carry margin
    const families = new Set<string>()
    for (const f of Object.values(m.by_fintech)) {
      for (const [family, acc] of Object.entries(f.by_family)) if (acc.margin > 0) families.add(family)
    }
    expect(families.has('SIP')).toBe(true)
    expect(families.has('AISP')).toBe(true)
    expect(families.has('CoP')).toBe(true)
  })
})

describe('run + monthly sign-off margin integration', () => {
  it('the daily run computes a margin and the run result carries it', async () => {
    const run = await new ReconciliationService({
      store: new InMemoryReconciliationLogStore(),
      breakStore: new InMemoryReconciliationBreakStore(),
      audit: new InMemoryHighClassAuditSink()
    }).runDaily('t', { window: WINDOW })
    expect(run.margin.total_margin).toBeGreaterThan(0)
  })
})
