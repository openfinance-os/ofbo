import { SectionCard, StatStrip, KpiStat, ContributionBar } from './ui'
import { formatMoney, type TppCounterparty, type Money } from '../lib/tpp-billing'

/**
 * UIF-08 — the TPP Billing overview (ADR 0016, Stitch 3d6d14a3). Built on the UIF-01
 * primitives and computed from the live counterparty list (no Stitch mock values): a KPI
 * StatStrip (consuming-TPP count, registered, unbilled-traffic, MTD fee accrual summed from
 * integer minor units) + a ContributionBar of the registration_state distribution. Additive —
 * the existing registry table, invoice runs, and mutations are untouched. Token-only.
 */

const STATES = ['unregistered', 'onboarding', 'registered', 'suspended'] as const
const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase())

export function TppBillingOverview({ counterparties }: { counterparties: TppCounterparty[] }) {
  const total = counterparties.length
  const registered = counterparties.filter((c) => c.registration_state === 'registered').length
  const unbilled = counterparties.filter((c) => c.unbilled_traffic).length
  const accruals = counterparties.map((c) => c.mtd_fee_accrual).filter((m): m is Money => m != null)
  const currency = accruals[0]?.currency ?? 'AED'
  const mtdTotal = accruals.filter((a) => a.currency === currency).reduce((sum, a) => sum + a.amount, 0)
  const segments = STATES.map((st) => ({ label: humanize(st), value: counterparties.filter((c) => c.registration_state === st).length })).filter(
    (s) => s.value > 0
  )
  return (
    <SectionCard title="Billing Overview" testid="tpp-billing-overview">
      <div className="space-y-4 p-4">
        <StatStrip aria-label="TPP billing metrics">
          <KpiStat label="Consuming TPPs" value={String(total)} valueTestid="kpi-total-tpps" />
          <KpiStat label="Registered" value={String(registered)} valueTestid="kpi-registered" sublabel={total ? `of ${total}` : undefined} />
          <KpiStat label="Unbilled traffic" value={String(unbilled)} valueTestid="kpi-unbilled" sublabel={unbilled ? 'action required' : 'all billed'} />
          <KpiStat label="MTD fee accrual" value={formatMoney({ amount: mtdTotal, currency })} valueTestid="kpi-mtd" />
        </StatStrip>
        {segments.length ? <ContributionBar label="Registration state" segments={segments} /> : null}
      </div>
    </SectionCard>
  )
}
