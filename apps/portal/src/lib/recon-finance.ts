import { getFinanceView, type AnalyticsApiDeps, type AnalyticsView } from './analytics'
import type { Money } from './reconciliation'

/**
 * UIF-07b — the TPP-aaS financial-reconciliation slice of the recon console, derived
 * from the BACKOFFICE-31 Finance View (reconciliation:read — the same scope the recon
 * console already holds). The three reconciliation sources at the money level: A = Nebras
 * billing (total_nebras_fee), C = downstream fintech re-bill (total_fintech_charge), with
 * the bank's margin = C − A; B (platform metering-of-record) is the basis that ties A out
 * and is shown via the run's match counts. Margin is bucketed per fintech (client_id) and
 * per product family (SIP / AISP / CoP). Free-form contract data → parsed defensively.
 */
export interface ReconFinance {
  period: string
  currency: string
  nebras_billed: Money // source A
  fintech_rebilled: Money // source C
  net_margin: Money // C − A
  open_nebras_disputes: number
  by_fintech: { client_id: string; margin: number }[]
  by_family: { family: string; margin: number }[]
  /** UIF-07b — the three reconciliation SOURCE totals (A Nebras / B platform metering / C fintech); null when absent. */
  source_totals: { nebras: Money; platform: Money; fintech: Money } | null
}

type RawMoney = { amount?: number; currency?: string }
type RawMargin = {
  currency?: string
  total_nebras_fee?: number
  total_fintech_charge?: number
  total_margin?: number
  by_fintech?: Record<string, { total_margin?: number; by_family?: Record<string, { margin?: number }> }>
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Parse a Finance View envelope into the recon-finance shape, or null when no margin is present. */
export function reconFinanceFromView(view: AnalyticsView): ReconFinance | null {
  const data = view.data as {
    period?: string
    tpp_aas_margin?: RawMargin
    open_nebras_dispute_count?: number
    three_way_source_totals?: { nebras_billing?: RawMoney; platform_metering?: RawMoney; fintech_rebill?: RawMoney }
  }
  const margin = data.tpp_aas_margin
  if (!margin || typeof margin !== 'object') return null
  const currency = margin.currency ?? 'AED'
  const st = data.three_way_source_totals
  const money = (m: RawMoney | undefined): Money => ({ amount: num(m?.amount), currency: m?.currency ?? currency })
  const source_totals = st && typeof st === 'object' ? { nebras: money(st.nebras_billing), platform: money(st.platform_metering), fintech: money(st.fintech_rebill) } : null
  const byFintech = margin.by_fintech ?? {}

  const by_fintech = Object.entries(byFintech)
    .map(([client_id, fm]) => ({ client_id, margin: num(fm?.total_margin) }))
    .filter((f) => f.margin > 0)
    .sort((a, b) => b.margin - a.margin)

  const familyTotals: Record<string, number> = {}
  for (const fm of Object.values(byFintech)) {
    for (const [family, acc] of Object.entries(fm?.by_family ?? {})) familyTotals[family] = (familyTotals[family] ?? 0) + num(acc?.margin)
  }
  const by_family = Object.entries(familyTotals)
    .map(([family, margin]) => ({ family, margin }))
    .filter((f) => f.margin > 0)
    .sort((a, b) => b.margin - a.margin)

  return {
    period: data.period ?? '',
    currency,
    nebras_billed: { amount: num(margin.total_nebras_fee), currency },
    fintech_rebilled: { amount: num(margin.total_fintech_charge), currency },
    net_margin: { amount: num(margin.total_margin), currency },
    open_nebras_disputes: num(data.open_nebras_dispute_count),
    by_fintech,
    by_family,
    source_totals
  }
}

/** Fetch + parse the recon-finance slice; null on any error so the panel degrades silently. */
export async function getReconFinance(token: string, deps: AnalyticsApiDeps = {}): Promise<ReconFinance | null> {
  try {
    return reconFinanceFromView(await getFinanceView(token, deps))
  } catch {
    return null
  }
}
