import type { FintechBillingLine, NebrasBillingLine, PlatformLogLine } from './engine.js'
import type { ReconLineType } from './fee-schedule.js'

/**
 * BACKOFFICE-07 — TPP-as-a-Service pass-through billing + margin tracking. The bank,
 * as TPP-of-record, consumes APIs on behalf of downstream fintechs, pays Nebras a
 * per-call fee, and re-bills the fintech with margin. This correlates each Nebras
 * pass-through fee with the downstream fintech billing entry (by line_ref) and
 * computes margin = fintech charge − Nebras fee, bucketed per fintech (client_id)
 * and product family (SIP / AISP / CoP). All amounts are integer fils.
 */

export type ProductFamily = 'SIP' | 'AISP' | 'CoP' | 'OTHER'

/** Map a reconciliation line type to its commercial product family. */
export function productFamily(lineType: ReconLineType): ProductFamily {
  switch (lineType) {
    case 'payment_settlement':
      return 'SIP'
    case 'lfi_access_log':
    case 'tpp_aas_pass_through':
    case 'dao_api_call': // BACKOFFICE-68 — DAO is a data-sharing (AISP-family) product
      return 'AISP'
    case 'consent_record':
      return 'CoP'
    default:
      return 'OTHER'
  }
}

export interface FamilyMargin {
  nebras_fee: number
  fintech_charge: number
  margin: number
}
export interface FintechMargin {
  client_id: string
  by_family: Record<string, FamilyMargin>
  total_margin: number
}
export interface MarginSummary {
  currency: string
  by_fintech: Record<string, FintechMargin>
  total_nebras_fee: number
  total_fintech_charge: number
  total_margin: number
}

export function emptyMargin(): MarginSummary {
  return { currency: 'AED', by_fintech: {}, total_nebras_fee: 0, total_fintech_charge: 0, total_margin: 0 }
}

function addFamily(into: MarginSummary, client: string, family: ProductFamily, nebrasFee: number, charge: number): void {
  const fm = (into.by_fintech[client] ??= { client_id: client, by_family: {}, total_margin: 0 })
  const acc = (fm.by_family[family] ??= { nebras_fee: 0, fintech_charge: 0, margin: 0 })
  acc.nebras_fee += nebrasFee
  acc.fintech_charge += charge
  acc.margin += charge - nebrasFee
  fm.total_margin += charge - nebrasFee
  into.total_nebras_fee += nebrasFee
  into.total_fintech_charge += charge
  into.total_margin += charge - nebrasFee
}

export function computeTppAasMargin(input: {
  nebras: NebrasBillingLine[]
  fintech: FintechBillingLine[]
  platform: PlatformLogLine[]
}): MarginSummary {
  const nebrasByRef = new Map(input.nebras.map((l) => [l.line_ref, l]))
  const clientByRef = new Map<string, string>()
  for (const p of input.platform) if (p.client_id) clientByRef.set(p.line_ref, p.client_id)
  for (const n of input.nebras) if (n.client_id && !clientByRef.has(n.line_ref)) clientByRef.set(n.line_ref, n.client_id)

  const out = emptyMargin()
  // A fintech billing entry is the downstream re-bill for a line the bank consumed
  // via Nebras — correlate by line_ref to the Nebras fee.
  for (const f of input.fintech) {
    const n = nebrasByRef.get(f.line_ref)
    if (!n) continue
    addFamily(out, clientByRef.get(f.line_ref) ?? 'unknown', productFamily(n.line_type), n.billed_fee.amount, f.billed_fee.amount)
  }
  return out
}

/** Accumulate per-run margins into a period total (monthly sign-off). */
export function mergeMargin(into: MarginSummary, add: MarginSummary): MarginSummary {
  for (const [client, fm] of Object.entries(add.by_fintech)) {
    for (const [family, acc] of Object.entries(fm.by_family)) {
      addFamily(into, client, family as ProductFamily, acc.nebras_fee, acc.fintech_charge)
    }
  }
  return into
}
