import { describe, expect, it } from 'vitest'
import type { ProfitabilityAmounts, ProfitabilityReport } from '@ofbo/billing'
import { collectionsWire, profitabilityReportWire } from '../src/billing/wire.js'

/**
 * BACKOFFICE-87 — snake_case is a binding convention, and two endpoints disagreed about it.
 *
 * CLAUDE.md §"API conventions" says snake_case JSON fields, full stop. `GET
 * /back-office/billing/console` mapped its collections and profitability payloads correctly
 * through `wire.ts`; `GET /back-office/analytics/finance-view` spread the SAME TypeScript objects
 * onto the wire unmapped, so `dso_by_tpp[]` and `tpp_profitability` shipped camelCase keys —
 * `tppId`, `dsoDays`, `openMilliFils`, `byProductFamily`.
 *
 * Nothing caught it because `AnalyticsView.data` is `additionalProperties: true` in the OpenAPI —
 * the schema permits any shape, so only the convention forbids it, and a convention with no
 * assertion behind it is a preference. The identical payload was snake_case on one endpoint and
 * camelCase on the other, which is what made this a leak rather than a deliberate choice.
 *
 * These assert the MAPPERS, which both endpoints now share — one shape, one place to change it.
 */

const CAMEL = /[a-z][A-Z]/

/** Every key at every depth — a nested camelCase key is the one that slipped through before. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, acc)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k)
      allKeys(v, acc)
    }
  }
  return acc
}

describe('finance-view / billing-console share one wire shape', () => {
  it('collectionsWire emits snake_case at every depth, including inside dso_by_tpp', () => {
    const wire = collectionsWire({
      openInvoiceCount: 2,
      openMilliFils: 5_000_000,
      settlementBreakCount: 1,
      settlementExpectedNetMilliFils: 9_000_000,
      settlementReceivedMilliFils: 8_000_000,
      settlementResidueMilliFils: 1_000_000,
      dunningByState: { reminded: 1 },
      dsoByTpp: [
        { tppId: 'org-tabby', dsoDays: 12, invoiceCount: 3, openInvoiceCount: 1, openMilliFils: 5_000_000 }
      ]
    })

    const offenders = allKeys(wire).filter((k) => CAMEL.test(k))
    expect(offenders, 'camelCase keys reached the wire').toEqual([])
    // The nested row specifically — this is the one that shipped as `tppId`.
    expect(Object.keys((wire.dso_by_tpp as Record<string, unknown>[])[0]!)).toContain('tpp_id')
  })

  it('profitabilityReportWire emits snake_case at every depth', () => {
    const amounts: ProfitabilityAmounts = {
      receivableMilliFils: 10_000_000,
      hubCostMilliFils: 2_000_000,
      lfiCostMilliFils: 1_000_000,
      liabilityProvisionMilliFils: 0,
      tppAasMarginMilliFils: 500_000,
      profitMilliFils: 7_000_000
    }
    // Typed, not cast — a cast here would let the fixture drift from the real report shape and
    // quietly stop exercising the mapper the endpoint actually calls.
    const report: ProfitabilityReport = {
      period: '2026-08',
      currency: 'AED',
      totals: amounts,
      byTpp: [{ ...amounts, tppId: 'org-tabby', sourceRefs: [], profitAed: 70 }],
      byProductFamily: [{ ...amounts, productFamily: 'data', sourceRefs: [], profitAed: 70 }],
      reconciliation: { balanced: true, deltaMilliFils: 0 }
    }
    const wire = profitabilityReportWire(report)

    const offenders = allKeys(wire).filter((k) => CAMEL.test(k))
    expect(offenders, 'camelCase keys reached the wire').toEqual([])
    expect(Object.keys(wire)).toContain('by_product_family')
  })
})
