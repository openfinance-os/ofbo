import { SectionCard, StatStrip, KpiStat, ContributionBar } from './ui'
import { formatMoney } from '../lib/reconciliation'
import type { ReconFinance } from '../lib/recon-finance'

/**
 * UIF-07b — TPP-aaS Financial Reconciliation, the data-backed slice of the Stitch
 * "Reconciliation Console (Refined)" (46e55863). Additive panel on the recon console,
 * bound to the BACKOFFICE-31 Finance View margin series (no mock values): the three
 * reconciliation sources at the money level — A = Nebras billing, C = fintech re-bill,
 * net margin = C − A (B = bank metering-of-record reconciles A via the run match counts) —
 * plus Margin-by-Fintech and Margin-by-Product-Family. Token-only; UIF-01 primitives.
 *
 * The literal per-source LINE-amount table (source B has no money total in the recon
 * contract) and Export/monthly Sign-off (a four-eyes mutation, BACKOFFICE-06) remain
 * out of scope here — see the UIF-07b backlog note.
 */
export function ReconFinancePanel({ finance }: { finance: ReconFinance }) {
  const fintechSegments = finance.by_fintech.map((f) => ({ label: shortId(f.client_id), value: f.margin }))
  const familySegments = finance.by_family.map((f) => ({ label: f.family, value: f.margin }))
  return (
    <SectionCard title="TPP-aaS Financial Reconciliation" testid="recon-finance-panel">
      <div className="space-y-4">
        <StatStrip aria-label="TPP-aaS financial reconciliation">
          <KpiStat label="Nebras fees billed · A" value={formatMoney(finance.nebras_billed)} valueTestid="recon-fin-nebras" />
          <KpiStat label="Re-billed to fintechs · C" value={formatMoney(finance.fintech_rebilled)} valueTestid="recon-fin-fintech" />
          <KpiStat
            label="Net TPP-aaS margin"
            value={formatMoney(finance.net_margin)}
            sublabel="C − A"
            valueTestid="recon-fin-margin"
            trend={finance.net_margin.amount > 0 ? { label: 'positive', tone: 'reconciled' } : undefined}
          />
        </StatStrip>

        {finance.source_totals ? (
          <section aria-labelledby="three-source-heading" className="space-y-1.5">
            <h3 id="three-source-heading" className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Three-Way Source Comparison</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse" data-testid="three-source-table">
                <thead>
                  <tr className="border-b border-outline-variant text-xs uppercase tracking-wider text-on-surface-variant">
                    <th scope="col" className="text-left font-semibold py-1.5 pr-3">Source</th>
                    <th scope="col" className="text-right font-semibold py-1.5">Period total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-outline-variant/40">
                    <td className="py-1.5 pr-3 text-primary">A · Nebras billing</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-primary" data-testid="src-nebras">{formatMoney(finance.source_totals.nebras)}</td>
                  </tr>
                  <tr className="border-b border-outline-variant/40">
                    <td className="py-1.5 pr-3 text-primary">B · Bank platform metering</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-primary" data-testid="src-platform">{formatMoney(finance.source_totals.platform)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-primary">C · Fintech re-bill</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-primary" data-testid="src-fintech">{formatMoney(finance.source_totals.fintech)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-on-surface-variant">
              A (Nebras billed) reconciles against B (the bank&apos;s metering of record); C re-bills consuming fintechs with the bank&apos;s margin.
              {finance.open_nebras_disputes > 0 ? ` ${finance.open_nebras_disputes} open Nebras dispute${finance.open_nebras_disputes === 1 ? '' : 's'} for the period.` : ''}
            </p>
          </section>
        ) : null}

        {fintechSegments.length > 0 ? <ContributionBar label="Margin by fintech" segments={fintechSegments} /> : null}
        {familySegments.length > 0 ? <ContributionBar label="Margin by product family" segments={familySegments} /> : null}
      </div>
    </SectionCard>
  )
}

/** Consuming-TPP org ids are UUIDs; show a short, stable handle in the bar legend. */
function shortId(clientId: string): string {
  return clientId.length > 10 ? `tpp-${clientId.slice(0, 6)}` : clientId
}
